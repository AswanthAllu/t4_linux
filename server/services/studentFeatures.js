const UserProfile = require('../models/UserProfile');
const ChatSession = require('../models/ChatSession');
const loggingService = require('./loggingService');
const personalizationEngine = require('./personalizationEngine');
const fs = require('fs').promises;
const path = require('path');
const winston = require('winston');
const { v4: uuidv4 } = require('uuid');

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ filename: 'logs/student-features.log' }),
        new winston.transports.Console()
    ]
});

class StudentFeatures {
    constructor() {
        this.studyGroups = new Map();
        this.studyPlans = new Map();
        this.achievements = this.initializeAchievements();
        this.collaborationSessions = new Map();
    }

    initializeAchievements() {
        return {
            'first_chat': {
                name: 'Getting Started',
                description: 'Started your first conversation',
                icon: '🚀',
                points: 10
            },
            'streak_7': {
                name: 'Week Warrior',
                description: 'Maintained a 7-day study streak',
                icon: '🔥',
                points: 50
            },
            'streak_30': {
                name: 'Monthly Master',
                description: 'Maintained a 30-day study streak',
                icon: '💪',
                points: 200
            },
            'topic_expert': {
                name: 'Topic Expert',
                description: 'Mastered a subject area',
                icon: '🎓',
                points: 100
            },
            'helpful_peer': {
                name: 'Helpful Peer',
                description: 'Helped other students in study groups',
                icon: '🤝',
                points: 75
            },
            'content_creator': {
                name: 'Content Creator',
                description: 'Generated your first report or presentation',
                icon: '📝',
                points: 30
            },
            'problem_solver': {
                name: 'Problem Solver',
                description: 'Solved 100 practice problems',
                icon: '🧩',
                points: 150
            }
        };
    }

    // Study Schedule Management
    async createStudyPlan(userId, planData) {
        try {
            const planId = uuidv4();
            const studyPlan = {
                planId,
                userId,
                title: planData.title,
                description: planData.description,
                subjects: planData.subjects || [],
                schedule: {
                    startDate: new Date(planData.startDate),
                    endDate: new Date(planData.endDate),
                    dailyHours: planData.dailyHours || 2,
                    preferredTimes: planData.preferredTimes || ['morning'],
                    daysOfWeek: planData.daysOfWeek || [1, 2, 3, 4, 5] // Mon-Fri
                },
                goals: planData.goals || [],
                milestones: this.generateMilestones(planData),
                progress: {
                    completedSessions: 0,
                    totalSessions: this.calculateTotalSessions(planData),
                    currentStreak: 0,
                    longestStreak: 0,
                    completedTopics: [],
                    timeSpent: 0
                },
                settings: {
                    reminderEnabled: planData.reminderEnabled !== false,
                    reminderTime: planData.reminderTime || '09:00',
                    difficulty: planData.difficulty || 'intermediate',
                    studyStyle: planData.studyStyle || 'mixed'
                },
                createdAt: new Date(),
                isActive: true
            };

            this.studyPlans.set(planId, studyPlan);

            // Update user profile
            const userProfile = await UserProfile.findOne({ userId });
            if (userProfile) {
                userProfile.learningProgress.currentGoals = planData.goals || [];
                await userProfile.save();
            }

            // Log the activity
            await loggingService.logUserActivity(userId, 'study_plan_created', {
                planId,
                title: planData.title,
                duration: this.calculatePlanDuration(planData)
            });

            logger.info(`Created study plan ${planId} for user ${userId}`);

            return {
                planId,
                message: 'Study plan created successfully',
                nextSession: this.getNextStudySession(studyPlan)
            };

        } catch (error) {
            logger.error('Failed to create study plan:', error);
            throw error;
        }
    }

    async getStudyPlan(userId, planId) {
        try {
            const plan = this.studyPlans.get(planId);
            
            if (!plan || plan.userId !== userId) {
                return null;
            }

            // Add dynamic progress updates
            const updatedPlan = {
                ...plan,
                progress: await this.calculateCurrentProgress(plan),
                nextSession: this.getNextStudySession(plan),
                recommendations: await this.generateStudyRecommendations(plan)
            };

            return updatedPlan;

        } catch (error) {
            logger.error('Failed to get study plan:', error);
            return null;
        }
    }

    async updateStudyProgress(userId, planId, sessionData) {
        try {
            const plan = this.studyPlans.get(planId);
            
            if (!plan || plan.userId !== userId) {
                throw new Error('Study plan not found');
            }

            // Update progress
            plan.progress.completedSessions += 1;
            plan.progress.timeSpent += sessionData.duration || 0;
            
            if (sessionData.topicsCompleted) {
                plan.progress.completedTopics.push(...sessionData.topicsCompleted);
            }

            // Update streak
            const lastSessionDate = plan.lastSessionDate || new Date(0);
            const today = new Date();
            const daysDiff = Math.floor((today - lastSessionDate) / (1000 * 60 * 60 * 24));
            
            if (daysDiff === 1) {
                plan.progress.currentStreak += 1;
                plan.progress.longestStreak = Math.max(
                    plan.progress.longestStreak, 
                    plan.progress.currentStreak
                );
            } else if (daysDiff > 1) {
                plan.progress.currentStreak = 1;
            }

            plan.lastSessionDate = today;

            // Check for achievements
            const newAchievements = await this.checkAchievements(userId, plan, sessionData);

            // Log the session
            await loggingService.logUserActivity(userId, 'study_session_completed', {
                planId,
                duration: sessionData.duration,
                topicsCompleted: sessionData.topicsCompleted,
                streak: plan.progress.currentStreak
            });

            return {
                success: true,
                progress: plan.progress,
                achievements: newAchievements,
                nextSession: this.getNextStudySession(plan)
            };

        } catch (error) {
            logger.error('Failed to update study progress:', error);
            throw error;
        }
    }

    // Progress Tracking
    async getProgressDashboard(userId) {
        try {
            const userProfile = await UserProfile.findOne({ userId });
            if (!userProfile) {
                return null;
            }

            const userPlans = Array.from(this.studyPlans.values())
                .filter(plan => plan.userId === userId && plan.isActive);

            const recentSessions = await ChatSession.find({ userId })
                .sort({ createdAt: -1 })
                .limit(10)
                .lean();

            const dashboard = {
                overview: {
                    totalStudyTime: this.calculateTotalStudyTime(userPlans),
                    currentStreak: this.getCurrentStreak(userPlans),
                    longestStreak: this.getLongestStreak(userPlans),
                    completedTopics: userProfile.learningProgress.completedTopics.length,
                    activeGoals: userProfile.learningProgress.currentGoals.length
                },
                activePlans: userPlans.map(plan => ({
                    planId: plan.planId,
                    title: plan.title,
                    progress: (plan.progress.completedSessions / plan.progress.totalSessions) * 100,
                    nextSession: this.getNextStudySession(plan),
                    streak: plan.progress.currentStreak
                })),
                recentActivity: recentSessions.map(session => ({
                    date: session.createdAt,
                    topic: this.extractTopicFromSession(session),
                    duration: session.duration || 0,
                    messageCount: session.messages?.length || 0
                })),
                achievements: userProfile.learningProgress.achievements || [],
                weeklyProgress: await this.getWeeklyProgress(userId),
                subjectBreakdown: this.getSubjectBreakdown(userProfile),
                recommendations: await this.getPersonalizedRecommendations(userId)
            };

            return dashboard;

        } catch (error) {
            logger.error('Failed to get progress dashboard:', error);
            return null;
        }
    }

    async getWeeklyProgress(userId) {
        try {
            const oneWeekAgo = new Date();
            oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

            const recentSessions = await ChatSession.find({
                userId,
                createdAt: { $gte: oneWeekAgo }
            }).lean();

            const dailyProgress = {};
            
            for (let i = 0; i < 7; i++) {
                const date = new Date();
                date.setDate(date.getDate() - i);
                const dateKey = date.toDateString();
                dailyProgress[dateKey] = {
                    sessions: 0,
                    timeSpent: 0,
                    topics: []
                };
            }

            recentSessions.forEach(session => {
                const dateKey = session.createdAt.toDateString();
                if (dailyProgress[dateKey]) {
                    dailyProgress[dateKey].sessions += 1;
                    dailyProgress[dateKey].timeSpent += session.duration || 0;
                    const topic = this.extractTopicFromSession(session);
                    if (topic && !dailyProgress[dateKey].topics.includes(topic)) {
                        dailyProgress[dateKey].topics.push(topic);
                    }
                }
            });

            return Object.entries(dailyProgress).map(([date, data]) => ({
                date,
                ...data
            }));

        } catch (error) {
            logger.error('Failed to get weekly progress:', error);
            return [];
        }
    }

    // Study Groups and Collaboration
    async createStudyGroup(creatorId, groupData) {
        try {
            const groupId = uuidv4();
            const studyGroup = {
                groupId,
                name: groupData.name,
                description: groupData.description,
                subject: groupData.subject,
                creatorId,
                members: [creatorId],
                settings: {
                    maxMembers: groupData.maxMembers || 10,
                    isPublic: groupData.isPublic !== false,
                    requireApproval: groupData.requireApproval === true,
                    allowGuestAccess: groupData.allowGuestAccess === true
                },
                schedule: {
                    meetingTimes: groupData.meetingTimes || [],
                    timezone: groupData.timezone || 'UTC',
                    frequency: groupData.frequency || 'weekly'
                },
                resources: {
                    sharedDocuments: [],
                    discussionTopics: [],
                    practiceProblems: []
                },
                activity: {
                    totalSessions: 0,
                    lastActivity: new Date(),
                    messageCount: 0
                },
                createdAt: new Date(),
                isActive: true
            };

            this.studyGroups.set(groupId, studyGroup);

            // Log the activity
            await loggingService.logUserActivity(creatorId, 'study_group_created', {
                groupId,
                name: groupData.name,
                subject: groupData.subject
            });

            logger.info(`Created study group ${groupId} by user ${creatorId}`);

            return {
                groupId,
                message: 'Study group created successfully',
                inviteCode: this.generateInviteCode(groupId)
            };

        } catch (error) {
            logger.error('Failed to create study group:', error);
            throw error;
        }
    }

    async joinStudyGroup(userId, groupId, inviteCode = null) {
        try {
            const group = this.studyGroups.get(groupId);
            
            if (!group || !group.isActive) {
                throw new Error('Study group not found');
            }

            if (group.members.includes(userId)) {
                throw new Error('Already a member of this group');
            }

            if (group.members.length >= group.settings.maxMembers) {
                throw new Error('Study group is full');
            }

            // Verify invite code if group requires approval
            if (group.settings.requireApproval && inviteCode !== this.generateInviteCode(groupId)) {
                throw new Error('Invalid invite code');
            }

            group.members.push(userId);
            group.activity.lastActivity = new Date();

            // Log the activity
            await loggingService.logUserActivity(userId, 'study_group_joined', {
                groupId,
                groupName: group.name
            });

            logger.info(`User ${userId} joined study group ${groupId}`);

            return {
                success: true,
                message: 'Successfully joined study group',
                group: this.sanitizeGroupData(group)
            };

        } catch (error) {
            logger.error('Failed to join study group:', error);
            throw error;
        }
    }

    async startCollaborationSession(userId, groupId, sessionData) {
        try {
            const group = this.studyGroups.get(groupId);
            
            if (!group || !group.members.includes(userId)) {
                throw new Error('Access denied to study group');
            }

            const sessionId = uuidv4();
            const collaborationSession = {
                sessionId,
                groupId,
                hostId: userId,
                participants: [userId],
                topic: sessionData.topic,
                description: sessionData.description,
                type: sessionData.type || 'discussion', // discussion, problem-solving, review
                startTime: new Date(),
                endTime: null,
                resources: sessionData.resources || [],
                chat: [],
                whiteboardData: null,
                recordings: [],
                isActive: true
            };

            this.collaborationSessions.set(sessionId, collaborationSession);

            // Update group activity
            group.activity.totalSessions += 1;
            group.activity.lastActivity = new Date();

            // Log the activity
            await loggingService.logUserActivity(userId, 'collaboration_session_started', {
                sessionId,
                groupId,
                topic: sessionData.topic
            });

            logger.info(`Started collaboration session ${sessionId} in group ${groupId}`);

            return {
                sessionId,
                message: 'Collaboration session started',
                joinUrl: `/collaborate/${sessionId}`
            };

        } catch (error) {
            logger.error('Failed to start collaboration session:', error);
            throw error;
        }
    }

    // Achievement System
    async checkAchievements(userId, studyPlan, sessionData) {
        try {
            const userProfile = await UserProfile.findOne({ userId });
            if (!userProfile) return [];

            const newAchievements = [];
            const existingAchievements = userProfile.learningProgress.achievements.map(a => a.name);

            // Check for streak achievements
            if (studyPlan.progress.currentStreak === 7 && !existingAchievements.includes('Week Warrior')) {
                newAchievements.push(this.achievements.streak_7);
            }

            if (studyPlan.progress.currentStreak === 30 && !existingAchievements.includes('Monthly Master')) {
                newAchievements.push(this.achievements.streak_30);
            }

            // Check for topic mastery
            if (sessionData.topicsCompleted && sessionData.topicsCompleted.length > 0) {
                const completedTopicsCount = userProfile.learningProgress.completedTopics.length;
                if (completedTopicsCount >= 10 && !existingAchievements.includes('Topic Expert')) {
                    newAchievements.push(this.achievements.topic_expert);
                }
            }

            // Check for content creation
            if (sessionData.contentGenerated && !existingAchievements.includes('Content Creator')) {
                newAchievements.push(this.achievements.content_creator);
            }

            // Save new achievements
            if (newAchievements.length > 0) {
                const achievementRecords = newAchievements.map(achievement => ({
                    name: achievement.name,
                    description: achievement.description,
                    earnedDate: new Date(),
                    category: 'study'
                }));

                userProfile.learningProgress.achievements.push(...achievementRecords);
                await userProfile.save();

                // Log achievements
                await loggingService.logUserActivity(userId, 'achievements_earned', {
                    achievements: newAchievements.map(a => a.name),
                    count: newAchievements.length
                });
            }

            return newAchievements;

        } catch (error) {
            logger.error('Failed to check achievements:', error);
            return [];
        }
    }

    // Utility Methods
    generateMilestones(planData) {
        const milestones = [];
        const duration = new Date(planData.endDate) - new Date(planData.startDate);
        const durationDays = Math.ceil(duration / (1000 * 60 * 60 * 24));
        
        // Create milestones at 25%, 50%, 75%, and 100% completion
        [0.25, 0.5, 0.75, 1.0].forEach((percentage, index) => {
            const milestoneDate = new Date(planData.startDate);
            milestoneDate.setDate(milestoneDate.getDate() + Math.floor(durationDays * percentage));
            
            milestones.push({
                id: `milestone_${index + 1}`,
                title: `${Math.floor(percentage * 100)}% Complete`,
                description: `Reach ${Math.floor(percentage * 100)}% of your study goals`,
                targetDate: milestoneDate,
                completed: false,
                completedDate: null
            });
        });

        return milestones;
    }

    calculateTotalSessions(planData) {
        const duration = new Date(planData.endDate) - new Date(planData.startDate);
        const durationDays = Math.ceil(duration / (1000 * 60 * 60 * 24));
        const studyDaysPerWeek = planData.daysOfWeek?.length || 5;
        const totalWeeks = Math.ceil(durationDays / 7);
        
        return totalWeeks * studyDaysPerWeek;
    }

    calculatePlanDuration(planData) {
        const duration = new Date(planData.endDate) - new Date(planData.startDate);
        return Math.ceil(duration / (1000 * 60 * 60 * 24));
    }

    getNextStudySession(plan) {
        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        
        // Find next scheduled day
        const dayOfWeek = tomorrow.getDay();
        const isScheduledDay = plan.schedule.daysOfWeek.includes(dayOfWeek === 0 ? 7 : dayOfWeek);
        
        return {
            date: isScheduledDay ? tomorrow : this.getNextScheduledDay(plan, tomorrow),
            time: plan.settings.reminderTime,
            duration: plan.schedule.dailyHours * 60, // minutes
            suggestedTopics: this.getSuggestedTopics(plan)
        };
    }

    getNextScheduledDay(plan, fromDate) {
        const nextDate = new Date(fromDate);
        
        for (let i = 1; i <= 7; i++) {
            nextDate.setDate(nextDate.getDate() + 1);
            const dayOfWeek = nextDate.getDay();
            const scheduledDay = dayOfWeek === 0 ? 7 : dayOfWeek;
            
            if (plan.schedule.daysOfWeek.includes(scheduledDay)) {
                return nextDate;
            }
        }
        
        return nextDate;
    }

    getSuggestedTopics(plan) {
        // Return topics that haven't been completed yet
        const allTopics = plan.subjects.flatMap(subject => subject.topics || []);
        const completedTopics = plan.progress.completedTopics;
        
        return allTopics.filter(topic => !completedTopics.includes(topic)).slice(0, 3);
    }

    async calculateCurrentProgress(plan) {
        // This would calculate real-time progress based on user activity
        return plan.progress;
    }

    async generateStudyRecommendations(plan) {
        const recommendations = [];
        
        // Based on progress and performance
        if (plan.progress.currentStreak === 0) {
            recommendations.push({
                type: 'motivation',
                title: 'Get Back on Track',
                description: 'Start a new study session to rebuild your streak',
                priority: 'high'
            });
        }
        
        if (plan.progress.completedSessions < plan.progress.totalSessions * 0.5) {
            recommendations.push({
                type: 'schedule',
                title: 'Increase Study Time',
                description: 'Consider adding more study sessions to stay on track',
                priority: 'medium'
            });
        }

        return recommendations;
    }

    calculateTotalStudyTime(plans) {
        return plans.reduce((total, plan) => total + plan.progress.timeSpent, 0);
    }

    getCurrentStreak(plans) {
        return Math.max(...plans.map(plan => plan.progress.currentStreak), 0);
    }

    getLongestStreak(plans) {
        return Math.max(...plans.map(plan => plan.progress.longestStreak), 0);
    }

    extractTopicFromSession(session) {
        // Extract topic from session messages (simplified)
        if (session.messages && session.messages.length > 0) {
            const firstMessage = session.messages[0];
            return firstMessage.content?.substring(0, 50) + '...' || 'General Discussion';
        }
        return 'General Discussion';
    }

    getSubjectBreakdown(userProfile) {
        const subjects = {};
        userProfile.preferences.subjects.forEach(subject => {
            subjects[subject.name] = {
                proficiencyLevel: subject.proficiencyLevel,
                interests: subject.interests || [],
                timeSpent: 0 // Would be calculated from actual data
            };
        });
        return subjects;
    }

    async getPersonalizedRecommendations(userId) {
        try {
            const context = await personalizationEngine.getPersonalizedContext(userId);
            return context.suggestions || [];
        } catch (error) {
            logger.error('Failed to get personalized recommendations:', error);
            return [];
        }
    }

    generateInviteCode(groupId) {
        // Generate a simple invite code based on groupId
        return Buffer.from(groupId).toString('base64').substring(0, 8).toUpperCase();
    }

    sanitizeGroupData(group) {
        return {
            groupId: group.groupId,
            name: group.name,
            description: group.description,
            subject: group.subject,
            memberCount: group.members.length,
            settings: {
                maxMembers: group.settings.maxMembers,
                isPublic: group.settings.isPublic
            },
            activity: group.activity,
            createdAt: group.createdAt
        };
    }

    // Public API methods
    async getUserStudyPlans(userId) {
        const userPlans = Array.from(this.studyPlans.values())
            .filter(plan => plan.userId === userId && plan.isActive);
        
        return userPlans.map(plan => ({
            planId: plan.planId,
            title: plan.title,
            description: plan.description,
            progress: (plan.progress.completedSessions / plan.progress.totalSessions) * 100,
            streak: plan.progress.currentStreak,
            nextSession: this.getNextStudySession(plan),
            createdAt: plan.createdAt
        }));
    }

    async getUserStudyGroups(userId) {
        const userGroups = Array.from(this.studyGroups.values())
            .filter(group => group.members.includes(userId) && group.isActive);
        
        return userGroups.map(group => this.sanitizeGroupData(group));
    }

    async getPublicStudyGroups(subject = null) {
        const publicGroups = Array.from(this.studyGroups.values())
            .filter(group => group.settings.isPublic && group.isActive);
        
        if (subject) {
            return publicGroups.filter(group => 
                group.subject.toLowerCase().includes(subject.toLowerCase())
            ).map(group => this.sanitizeGroupData(group));
        }
        
        return publicGroups.map(group => this.sanitizeGroupData(group));
    }
}

module.exports = new StudentFeatures();