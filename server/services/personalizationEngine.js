const UserProfile = require('../models/UserProfile');
const ChatSession = require('../models/ChatSession');
const winston = require('winston');

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ filename: 'logs/personalization.log' }),
        new winston.transports.Console()
    ]
});

class PersonalizationEngine {
    constructor() {
        this.userContextCache = new Map();
        this.learningPatterns = new Map();
        this.responseTemplates = this.initializeResponseTemplates();
    }

    // Initialize response templates for different user types
    initializeResponseTemplates() {
        return {
            beginner: {
                prefix: "Let me explain this step by step. ",
                style: "simple",
                includeBasics: true,
                exampleCount: 2
            },
            intermediate: {
                prefix: "Here's what you need to know: ",
                style: "balanced",
                includeBasics: false,
                exampleCount: 1
            },
            advanced: {
                prefix: "Diving into the details: ",
                style: "technical",
                includeBasics: false,
                exampleCount: 0
            },
            visual: {
                preferDiagrams: true,
                suggestMindMaps: true,
                useAnalogies: true
            },
            auditory: {
                suggestPodcasts: true,
                useVerbalExplanations: true,
                includeDiscussionPoints: true
            },
            kinesthetic: {
                suggestHandsOn: true,
                includeExercises: true,
                emphasizePractical: true
            }
        };
    }

    // Get personalized context for a user
    async getPersonalizedContext(userId) {
        try {
            // Check cache first
            if (this.userContextCache.has(userId)) {
                const cached = this.userContextCache.get(userId);
                // Return cached if less than 1 hour old
                if (Date.now() - cached.timestamp < 3600000) {
                    return cached.context;
                }
            }

            const userProfile = await UserProfile.findOne({ userId });
            if (!userProfile) {
                return this.getDefaultContext();
            }

            const context = await this.buildPersonalizedContext(userProfile);
            
            // Cache the context
            this.userContextCache.set(userId, {
                context,
                timestamp: Date.now()
            });

            return context;
        } catch (error) {
            logger.error('Failed to get personalized context:', error);
            return this.getDefaultContext();
        }
    }

    // Build personalized context from user profile
    async buildPersonalizedContext(userProfile) {
        const recentSessions = await this.getRecentSessions(userProfile.userId, 10);
        const learningPattern = this.analyzeLearningPattern(userProfile, recentSessions);
        
        return {
            userId: userProfile.userId,
            preferences: userProfile.preferences,
            learningStyle: userProfile.preferences.learningStyle,
            proficiencyLevel: this.determineProficiencyLevel(userProfile),
            interests: this.extractInterests(userProfile),
            conversationHistory: this.summarizeConversationHistory(recentSessions),
            responsePreferences: this.determineResponsePreferences(userProfile),
            currentGoals: userProfile.learningProgress.currentGoals || [],
            strengths: learningPattern.strengths,
            weaknesses: learningPattern.weaknesses,
            preferredTopics: this.getPreferredTopics(userProfile),
            communicationStyle: this.determineCommunicationStyle(userProfile),
            attentionSpan: this.estimateAttentionSpan(userProfile),
            lastActiveTopics: this.getLastActiveTopics(userProfile, 5)
        };
    }

    // Personalize response based on user context
    async personalizeResponse(userId, originalResponse, context = null) {
        try {
            const userContext = context || await this.getPersonalizedContext(userId);
            
            let personalizedResponse = originalResponse;

            // Apply learning style adaptations
            personalizedResponse = this.adaptForLearningStyle(personalizedResponse, userContext);
            
            // Apply proficiency level adaptations
            personalizedResponse = this.adaptForProficiencyLevel(personalizedResponse, userContext);
            
            // Add personalized elements
            personalizedResponse = this.addPersonalizedElements(personalizedResponse, userContext);
            
            // Apply communication style
            personalizedResponse = this.adaptCommunicationStyle(personalizedResponse, userContext);

            // Log personalization applied
            logger.info(`Applied personalization for user ${userId}`);
            
            return {
                response: personalizedResponse,
                personalizationApplied: this.getPersonalizationSummary(userContext),
                suggestions: this.generatePersonalizedSuggestions(userContext)
            };
        } catch (error) {
            logger.error('Failed to personalize response:', error);
            return { response: originalResponse, personalizationApplied: [], suggestions: [] };
        }
    }

    // Adapt response for learning style
    adaptForLearningStyle(response, context) {
        const style = context.learningStyle;
        const template = this.responseTemplates[style];
        
        if (!template) return response;

        let adaptedResponse = response;

        switch (style) {
            case 'visual':
                if (template.preferDiagrams) {
                    adaptedResponse += "\n\n💡 **Tip**: Consider creating a mind map or diagram to visualize these concepts better.";
                }
                if (template.useAnalogies && !response.includes('like') && !response.includes('similar to')) {
                    adaptedResponse = this.addVisualAnalogy(adaptedResponse);
                }
                break;
                
            case 'auditory':
                if (template.suggestPodcasts) {
                    adaptedResponse += "\n\n🎧 **Suggestion**: Try listening to educational podcasts about this topic for better retention.";
                }
                if (template.includeDiscussionPoints) {
                    adaptedResponse += "\n\n💬 **Discussion Points**: " + this.generateDiscussionPoints(response);
                }
                break;
                
            case 'kinesthetic':
                if (template.suggestHandsOn) {
                    adaptedResponse += "\n\n🔨 **Hands-on Activity**: " + this.suggestPracticalActivity(response);
                }
                if (template.includeExercises) {
                    adaptedResponse += "\n\n📝 **Practice Exercise**: " + this.generatePracticeExercise(response);
                }
                break;
                
            case 'reading':
                adaptedResponse += "\n\n📚 **Further Reading**: I can suggest some detailed resources if you'd like to dive deeper into this topic.";
                break;
        }

        return adaptedResponse;
    }

    // Adapt response for proficiency level
    adaptForProficiencyLevel(response, context) {
        const level = context.proficiencyLevel;
        const template = this.responseTemplates[level];
        
        if (!template) return response;

        let adaptedResponse = response;

        // Add appropriate prefix
        if (template.prefix && !response.startsWith(template.prefix)) {
            adaptedResponse = template.prefix + adaptedResponse;
        }

        // Adjust complexity based on level
        switch (level) {
            case 'beginner':
                if (template.includeBasics) {
                    adaptedResponse = this.addBasicExplanations(adaptedResponse);
                }
                adaptedResponse = this.simplifyLanguage(adaptedResponse);
                break;
                
            case 'intermediate':
                adaptedResponse = this.addContextualDetails(adaptedResponse);
                break;
                
            case 'advanced':
                adaptedResponse = this.addTechnicalDepth(adaptedResponse);
                adaptedResponse += "\n\n🔬 **Advanced Insight**: " + this.generateAdvancedInsight(response);
                break;
        }

        return adaptedResponse;
    }

    // Add personalized elements
    addPersonalizedElements(response, context) {
        let personalizedResponse = response;

        // Reference previous conversations
        if (context.lastActiveTopics.length > 0) {
            const relatedTopic = this.findRelatedTopic(response, context.lastActiveTopics);
            if (relatedTopic) {
                personalizedResponse = `Building on our previous discussion about ${relatedTopic}, ` + 
                    personalizedResponse.toLowerCase();
            }
        }

        // Reference current goals
        if (context.currentGoals.length > 0) {
            const relatedGoal = this.findRelatedGoal(response, context.currentGoals);
            if (relatedGoal) {
                personalizedResponse += `\n\n🎯 **Progress Note**: This relates to your goal of "${relatedGoal}".`;
            }
        }

        // Add encouragement based on learning progress
        if (context.strengths.length > 0) {
            personalizedResponse += `\n\n✨ **Your Strength**: You've shown good understanding in ${context.strengths[0]}, which will help here.`;
        }

        return personalizedResponse;
    }

    // Adapt communication style
    adaptCommunicationStyle(response, context) {
        const style = context.communicationStyle;
        
        switch (style) {
            case 'formal':
                return this.makeFormal(response);
            case 'casual':
                return this.makeCasual(response);
            case 'encouraging':
                return this.addEncouragement(response);
            case 'direct':
                return this.makeDirectAndConcise(response);
            default:
                return response;
        }
    }

    // Helper methods for response adaptation
    addVisualAnalogy(response) {
        const analogies = [
            "Think of this like building blocks - each concept builds on the previous one.",
            "Imagine this as a tree structure, with main concepts as branches and details as leaves.",
            "Picture this as a puzzle where each piece fits together to form the complete picture."
        ];
        return response + "\n\n" + analogies[Math.floor(Math.random() * analogies.length)];
    }

    generateDiscussionPoints(response) {
        return "What aspects of this topic would you like to explore further? How might this apply to your current projects?";
    }

    suggestPracticalActivity(response) {
        return "Try implementing a small example or experiment with these concepts to reinforce your understanding.";
    }

    generatePracticeExercise(response) {
        return "Create a simple project that incorporates these principles to strengthen your grasp of the material.";
    }

    addBasicExplanations(response) {
        // Add basic definitions and explanations for complex terms
        return response.replace(/\b([A-Z][a-z]+(?:[A-Z][a-z]+)*)\b/g, (match) => {
            // This is a simplified approach - in practice, you'd have a dictionary of terms
            return match + " (a key concept in this field)";
        });
    }

    simplifyLanguage(response) {
        // Replace complex words with simpler alternatives
        const replacements = {
            'utilize': 'use',
            'implement': 'put in place',
            'optimize': 'make better',
            'facilitate': 'help',
            'methodology': 'method'
        };
        
        let simplified = response;
        for (const [complex, simple] of Object.entries(replacements)) {
            simplified = simplified.replace(new RegExp(complex, 'gi'), simple);
        }
        return simplified;
    }

    addContextualDetails(response) {
        return response + "\n\n📋 **Context**: This concept is widely used in industry applications and understanding it will help you in practical scenarios.";
    }

    addTechnicalDepth(response) {
        return response + "\n\n⚙️ **Technical Details**: For implementation specifics and advanced configurations, consider the underlying algorithms and optimization strategies.";
    }

    generateAdvancedInsight(response) {
        return "Consider the scalability implications and how this might integrate with modern architectural patterns.";
    }

    // Analysis methods
    analyzeLearningPattern(userProfile, recentSessions) {
        const strengths = [];
        const weaknesses = [];
        
        // Analyze topic frequency and success patterns
        const topicPerformance = this.analyzeTopicPerformance(userProfile, recentSessions);
        
        for (const [topic, performance] of Object.entries(topicPerformance)) {
            if (performance.successRate > 0.8) {
                strengths.push(topic);
            } else if (performance.successRate < 0.5) {
                weaknesses.push(topic);
            }
        }

        return { strengths: strengths.slice(0, 3), weaknesses: weaknesses.slice(0, 3) };
    }

    analyzeTopicPerformance(userProfile, recentSessions) {
        // Simplified analysis - in practice, this would be more sophisticated
        const performance = {};
        
        userProfile.conversationMetrics.topicFrequency.forEach(topic => {
            performance[topic.topic] = {
                frequency: topic.count,
                successRate: Math.random() * 0.4 + 0.6 // Placeholder - would analyze actual performance
            };
        });

        return performance;
    }

    determineProficiencyLevel(userProfile) {
        // Analyze user's overall proficiency based on conversation patterns
        const totalMessages = userProfile.conversationMetrics.totalMessages;
        const averageSessionLength = userProfile.conversationMetrics.averageSessionLength;
        
        if (totalMessages > 100 && averageSessionLength > 15) return 'advanced';
        if (totalMessages > 30 && averageSessionLength > 8) return 'intermediate';
        return 'beginner';
    }

    extractInterests(userProfile) {
        return userProfile.preferences.subjects.flatMap(subject => subject.interests || []);
    }

    determineResponsePreferences(userProfile) {
        return {
            length: userProfile.conversationMetrics.preferredResponseLength,
            includeExamples: userProfile.preferences.learningStyle !== 'reading',
            includeVisuals: userProfile.preferences.learningStyle === 'visual'
        };
    }

    getPreferredTopics(userProfile) {
        return userProfile.conversationMetrics.topicFrequency
            .sort((a, b) => b.count - a.count)
            .slice(0, 5)
            .map(t => t.topic);
    }

    determineCommunicationStyle(userProfile) {
        // Analyze communication patterns from activity log
        const recentActivities = userProfile.activityLog.slice(-20);
        
        // Simplified determination - would analyze actual communication patterns
        if (userProfile.conversationMetrics.averageSessionLength > 20) return 'detailed';
        if (userProfile.conversationMetrics.totalMessages > 50) return 'casual';
        return 'balanced';
    }

    estimateAttentionSpan(userProfile) {
        return userProfile.conversationMetrics.averageSessionLength || 10;
    }

    getLastActiveTopics(userProfile, count = 5) {
        return userProfile.conversationMetrics.topicFrequency
            .sort((a, b) => new Date(b.lastUsed) - new Date(a.lastUsed))
            .slice(0, count)
            .map(t => t.topic);
    }

    // Utility methods
    async getRecentSessions(userId, limit = 10) {
        try {
            return await ChatSession.find({ userId })
                .sort({ createdAt: -1 })
                .limit(limit)
                .lean();
        } catch (error) {
            logger.error('Failed to get recent sessions:', error);
            return [];
        }
    }

    summarizeConversationHistory(sessions) {
        return sessions.map(session => ({
            date: session.createdAt,
            messageCount: session.messages?.length || 0,
            topics: session.topics || [],
            duration: session.duration || 0
        }));
    }

    findRelatedTopic(response, lastTopics) {
        // Simple keyword matching - would use more sophisticated NLP in practice
        for (const topic of lastTopics) {
            if (response.toLowerCase().includes(topic.toLowerCase())) {
                return topic;
            }
        }
        return null;
    }

    findRelatedGoal(response, goals) {
        for (const goal of goals) {
            if (response.toLowerCase().includes(goal.toLowerCase())) {
                return goal;
            }
        }
        return null;
    }

    getPersonalizationSummary(context) {
        return [
            `Learning Style: ${context.learningStyle}`,
            `Proficiency: ${context.proficiencyLevel}`,
            `Communication: ${context.communicationStyle}`,
            `Interests: ${context.interests.slice(0, 3).join(', ')}`
        ];
    }

    generatePersonalizedSuggestions(context) {
        const suggestions = [];
        
        if (context.weaknesses.length > 0) {
            suggestions.push(`Consider reviewing ${context.weaknesses[0]} to strengthen your understanding`);
        }
        
        if (context.currentGoals.length > 0) {
            suggestions.push(`Work on your goal: ${context.currentGoals[0]}`);
        }
        
        if (context.learningStyle === 'visual') {
            suggestions.push("Try creating a mind map for this topic");
        }
        
        return suggestions;
    }

    getDefaultContext() {
        return {
            learningStyle: 'balanced',
            proficiencyLevel: 'intermediate',
            communicationStyle: 'balanced',
            interests: [],
            currentGoals: [],
            strengths: [],
            weaknesses: [],
            preferredTopics: [],
            attentionSpan: 10,
            lastActiveTopics: []
        };
    }

    // Update user learning progress
    async updateLearningProgress(userId, topic, success, difficulty) {
        try {
            const userProfile = await UserProfile.findOne({ userId });
            if (userProfile) {
                // Update topic frequency
                const existingTopic = userProfile.conversationMetrics.topicFrequency
                    .find(t => t.topic === topic);
                
                if (existingTopic) {
                    existingTopic.count += 1;
                    existingTopic.lastUsed = new Date();
                } else {
                    userProfile.conversationMetrics.topicFrequency.push({
                        topic,
                        count: 1,
                        lastUsed: new Date()
                    });
                }

                // Update learning progress
                if (success && !userProfile.learningProgress.completedTopics.includes(topic)) {
                    userProfile.learningProgress.completedTopics.push(topic);
                }

                await userProfile.save();
                
                // Clear cache to force refresh
                this.userContextCache.delete(userId);
            }
        } catch (error) {
            logger.error('Failed to update learning progress:', error);
        }
    }
}

module.exports = new PersonalizationEngine();