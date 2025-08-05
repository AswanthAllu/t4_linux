const { GoogleGenerativeAI } = require('@google/generative-ai');
const multiLLMRouter = require('./multiLLMRouter');
const personalizationEngine = require('./personalizationEngine');
const loggingService = require('./loggingService');
const NodeCache = require('node-cache');
const winston = require('winston');

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ filename: 'logs/enhanced-gemini.log' }),
        new winston.transports.Console()
    ]
});

class EnhancedGeminiService {
    constructor() {
        this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        this.responseCache = new NodeCache({ stdTTL: 3600 }); // 1 hour cache
        this.promptTemplates = this.initializePromptTemplates();
        this.performanceMetrics = new Map();
        this.rateLimiter = new Map();
        this.maxRequestsPerMinute = 60;
    }

    initializePromptTemplates() {
        return {
            educational: {
                system: `You are an expert educational AI tutor specializing in engineering and technical subjects. Your responses should be:
- Clear and well-structured
- Appropriate for the student's level
- Include practical examples
- Encourage critical thinking
- Provide step-by-step explanations when needed`,
                
                chat: `Context: You're helping a student learn {subject}.
Student Level: {proficiencyLevel}
Learning Style: {learningStyle}

Previous Context: {previousContext}

Student Question: {question}

Provide a helpful, educational response that matches their learning style and level.`,

                reasoning: `You are tasked with complex reasoning about: {topic}

Context: {context}
Requirements: {requirements}

Think through this step-by-step:
1. Analyze the problem
2. Break down the components
3. Apply relevant principles
4. Draw logical conclusions
5. Verify your reasoning

Question: {question}`,

                technical: `You are a technical expert in {domain}.

Technical Context: {context}
Specifications: {specifications}
Constraints: {constraints}

Provide a detailed technical response addressing: {question}

Include:
- Technical accuracy
- Implementation details
- Best practices
- Potential issues and solutions`
            },

            optimization: {
                concise: "Provide a concise, direct answer focusing on key points.",
                detailed: "Provide a comprehensive explanation with examples and context.",
                stepByStep: "Break down your response into clear, numbered steps.",
                visual: "Include descriptions that would help visualize the concepts.",
                practical: "Focus on real-world applications and hands-on examples."
            }
        };
    }

    async generateResponse(prompt, options = {}) {
        const startTime = Date.now();
        
        try {
            // Check rate limiting
            await this.checkRateLimit(options.userId);

            // Check cache first
            const cacheKey = this.generateCacheKey(prompt, options);
            const cachedResponse = this.responseCache.get(cacheKey);
            
            if (cachedResponse && !options.bypassCache) {
                logger.info(`Cache hit for request from user ${options.userId}`);
                return {
                    ...cachedResponse,
                    fromCache: true,
                    responseTime: Date.now() - startTime
                };
            }

            // Route to appropriate LLM if multi-LLM is enabled
            let selectedModel = 'gemini-pro';
            if (options.useMultiLLM && options.userId) {
                const routing = await multiLLMRouter.routeRequest(
                    options.requestType || 'chat',
                    prompt,
                    options.userId,
                    options.context
                );
                
                if (routing.model.type !== 'gemini') {
                    // Route to different LLM - this would integrate with other LLM services
                    logger.info(`Routing to ${routing.model.name} instead of Gemini`);
                    // For now, continue with Gemini but log the routing decision
                }
            }

            // Enhance prompt with personalization
            const enhancedPrompt = await this.enhancePrompt(prompt, options);

            // Generate response with optimized parameters
            const model = this.genAI.getGenerativeModel({ 
                model: selectedModel,
                generationConfig: this.getOptimizedConfig(options)
            });

            const result = await model.generateContent(enhancedPrompt);
            const response = result.response;
            const text = response.text();

            // Post-process response
            const processedResponse = await this.postProcessResponse(text, options);

            // Apply personalization if user is provided
            let finalResponse = processedResponse;
            if (options.userId) {
                const personalized = await personalizationEngine.personalizeResponse(
                    options.userId,
                    processedResponse,
                    options.userContext
                );
                finalResponse = personalized.response;
            }

            const responseTime = Date.now() - startTime;

            // Cache the response
            const responseData = {
                text: finalResponse,
                originalText: text,
                model: selectedModel,
                responseTime,
                timestamp: new Date()
            };

            this.responseCache.set(cacheKey, responseData);

            // Log performance metrics
            await this.logPerformanceMetrics(options.userId, responseTime, true);

            // Log the interaction
            if (options.userId) {
                await loggingService.logConversation(options.userId, options.sessionId, {
                    messageId: options.messageId,
                    type: 'assistant',
                    content: finalResponse,
                    llmModel: selectedModel,
                    responseTime
                });
            }

            return {
                text: finalResponse,
                model: selectedModel,
                responseTime,
                fromCache: false,
                metadata: {
                    originalLength: text.length,
                    finalLength: finalResponse.length,
                    personalized: !!options.userId
                }
            };

        } catch (error) {
            const responseTime = Date.now() - startTime;
            
            logger.error('Enhanced Gemini service error:', error);
            
            // Log failed performance metrics
            await this.logPerformanceMetrics(options.userId, responseTime, false);

            // Return fallback response
            return {
                text: "I apologize, but I'm experiencing some technical difficulties. Please try again in a moment.",
                error: error.message,
                model: 'fallback',
                responseTime,
                fromCache: false
            };
        }
    }

    async enhancePrompt(originalPrompt, options) {
        try {
            let enhancedPrompt = originalPrompt;

            // Apply prompt template based on request type
            if (options.requestType && this.promptTemplates.educational[options.requestType]) {
                const template = this.promptTemplates.educational[options.requestType];
                enhancedPrompt = this.applyTemplate(template, {
                    question: originalPrompt,
                    subject: options.subject || 'general',
                    proficiencyLevel: options.proficiencyLevel || 'intermediate',
                    learningStyle: options.learningStyle || 'balanced',
                    previousContext: options.previousContext || '',
                    context: options.context || '',
                    topic: options.topic || '',
                    requirements: options.requirements || '',
                    domain: options.domain || '',
                    specifications: options.specifications || '',
                    constraints: options.constraints || ''
                });
            }

            // Add system context if provided
            if (options.systemContext) {
                enhancedPrompt = `${options.systemContext}\n\n${enhancedPrompt}`;
            }

            // Add optimization instructions
            if (options.responseStyle && this.promptTemplates.optimization[options.responseStyle]) {
                enhancedPrompt += `\n\nResponse Style: ${this.promptTemplates.optimization[options.responseStyle]}`;
            }

            // Add context from conversation history
            if (options.conversationHistory && options.conversationHistory.length > 0) {
                const recentHistory = options.conversationHistory.slice(-3); // Last 3 exchanges
                const historyContext = recentHistory.map(msg => 
                    `${msg.sender}: ${msg.content}`
                ).join('\n');
                
                enhancedPrompt = `Previous conversation:\n${historyContext}\n\nCurrent question: ${enhancedPrompt}`;
            }

            return enhancedPrompt;

        } catch (error) {
            logger.error('Error enhancing prompt:', error);
            return originalPrompt;
        }
    }

    applyTemplate(template, variables) {
        let result = template;
        
        Object.entries(variables).forEach(([key, value]) => {
            const placeholder = `{${key}}`;
            result = result.replace(new RegExp(placeholder, 'g'), value || '');
        });

        return result;
    }

    async postProcessResponse(text, options) {
        try {
            let processedText = text;

            // Clean up formatting
            processedText = this.cleanupFormatting(processedText);

            // Add educational enhancements
            if (options.requestType === 'educational') {
                processedText = this.addEducationalEnhancements(processedText, options);
            }

            // Apply length optimization
            if (options.maxLength && processedText.length > options.maxLength) {
                processedText = this.truncateIntelligently(processedText, options.maxLength);
            }

            // Add interactive elements
            if (options.includeInteractive) {
                processedText = this.addInteractiveElements(processedText);
            }

            return processedText;

        } catch (error) {
            logger.error('Error post-processing response:', error);
            return text;
        }
    }

    cleanupFormatting(text) {
        return text
            .replace(/\*\*(.*?)\*\*/g, '**$1**') // Ensure bold formatting
            .replace(/\n{3,}/g, '\n\n') // Remove excessive line breaks
            .replace(/\s+$/gm, '') // Remove trailing spaces
            .trim();
    }

    addEducationalEnhancements(text, options) {
        // Add relevant emojis for better engagement
        const emojiMap = {
            'mathematics': '📊',
            'physics': '⚡',
            'chemistry': '🧪',
            'engineering': '⚙️',
            'computer science': '💻'
        };

        const subject = options.subject?.toLowerCase();
        if (subject && emojiMap[subject]) {
            text = `${emojiMap[subject]} ${text}`;
        }

        // Add call-to-action for further learning
        if (options.includeFollowUp !== false) {
            text += '\n\n💡 **Want to explore this further?** Feel free to ask follow-up questions or request examples!';
        }

        return text;
    }

    truncateIntelligently(text, maxLength) {
        if (text.length <= maxLength) return text;

        // Try to truncate at sentence boundaries
        const sentences = text.split(/[.!?]+/);
        let truncated = '';
        
        for (const sentence of sentences) {
            if ((truncated + sentence).length > maxLength - 50) break;
            truncated += sentence + '.';
        }

        return truncated.trim() + '\n\n...(response truncated)';
    }

    addInteractiveElements(text) {
        // Add suggested follow-up questions
        const followUps = [
            'Would you like me to explain any part in more detail?',
            'Do you need examples for better understanding?',
            'Should we explore related topics?'
        ];

        const randomFollowUp = followUps[Math.floor(Math.random() * followUps.length)];
        return text + `\n\n🤔 **${randomFollowUp}**`;
    }

    getOptimizedConfig(options) {
        const baseConfig = {
            temperature: 0.7,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 2048,
        };

        // Adjust based on request type
        switch (options.requestType) {
            case 'reasoning':
                return { ...baseConfig, temperature: 0.3, topP: 0.8 }; // More focused
            case 'creative':
                return { ...baseConfig, temperature: 0.9, topP: 0.95 }; // More creative
            case 'technical':
                return { ...baseConfig, temperature: 0.4, maxOutputTokens: 4096 }; // Precise and detailed
            case 'chat':
            default:
                return baseConfig;
        }
    }

    generateCacheKey(prompt, options) {
        const keyData = {
            prompt: prompt.substring(0, 100), // First 100 chars
            userId: options.userId,
            requestType: options.requestType,
            subject: options.subject,
            proficiencyLevel: options.proficiencyLevel
        };

        return Buffer.from(JSON.stringify(keyData)).toString('base64');
    }

    async checkRateLimit(userId) {
        if (!userId) return;

        const now = Date.now();
        const userKey = `rate_${userId}`;
        const userRequests = this.rateLimiter.get(userKey) || [];

        // Remove requests older than 1 minute
        const recentRequests = userRequests.filter(time => now - time < 60000);

        if (recentRequests.length >= this.maxRequestsPerMinute) {
            throw new Error('Rate limit exceeded. Please wait before making another request.');
        }

        recentRequests.push(now);
        this.rateLimiter.set(userKey, recentRequests);
    }

    async logPerformanceMetrics(userId, responseTime, success) {
        try {
            const metrics = {
                userId,
                responseTime,
                success,
                timestamp: new Date()
            };

            // Update running averages
            const userMetrics = this.performanceMetrics.get(userId) || {
                totalRequests: 0,
                successfulRequests: 0,
                averageResponseTime: 0,
                lastRequest: null
            };

            userMetrics.totalRequests += 1;
            if (success) userMetrics.successfulRequests += 1;
            
            userMetrics.averageResponseTime = 
                (userMetrics.averageResponseTime * (userMetrics.totalRequests - 1) + responseTime) / 
                userMetrics.totalRequests;
            
            userMetrics.lastRequest = new Date();

            this.performanceMetrics.set(userId, userMetrics);

            // Log to logging service
            await loggingService.logPerformance('gemini_request', responseTime, {
                userId,
                success,
                model: 'gemini-pro'
            });

        } catch (error) {
            logger.error('Failed to log performance metrics:', error);
        }
    }

    // Public API methods
    async chat(message, userId, options = {}) {
        return await this.generateResponse(message, {
            ...options,
            userId,
            requestType: 'chat'
        });
    }

    async explain(topic, userId, options = {}) {
        const prompt = `Please explain ${topic} in detail.`;
        return await this.generateResponse(prompt, {
            ...options,
            userId,
            requestType: 'educational',
            responseStyle: 'detailed'
        });
    }

    async solve(problem, userId, options = {}) {
        const prompt = `Help me solve this problem: ${problem}`;
        return await this.generateResponse(prompt, {
            ...options,
            userId,
            requestType: 'reasoning',
            responseStyle: 'stepByStep'
        });
    }

    async analyze(content, userId, options = {}) {
        const prompt = `Please analyze the following: ${content}`;
        return await this.generateResponse(prompt, {
            ...options,
            userId,
            requestType: 'reasoning',
            responseStyle: 'detailed'
        });
    }

    // Cache management
    clearCache() {
        this.responseCache.flushAll();
        logger.info('Response cache cleared');
    }

    getCacheStats() {
        return {
            keys: this.responseCache.keys().length,
            hits: this.responseCache.getStats().hits,
            misses: this.responseCache.getStats().misses
        };
    }

    // Performance monitoring
    getPerformanceStats(userId = null) {
        if (userId) {
            return this.performanceMetrics.get(userId) || null;
        }

        const allMetrics = Array.from(this.performanceMetrics.values());
        return {
            totalUsers: allMetrics.length,
            averageResponseTime: allMetrics.reduce((sum, m) => sum + m.averageResponseTime, 0) / allMetrics.length,
            totalRequests: allMetrics.reduce((sum, m) => sum + m.totalRequests, 0),
            successRate: allMetrics.reduce((sum, m) => sum + (m.successfulRequests / m.totalRequests), 0) / allMetrics.length * 100
        };
    }
}

module.exports = new EnhancedGeminiService();