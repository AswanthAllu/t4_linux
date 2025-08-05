const winston = require('winston');
const UserProfile = require('../models/UserProfile');
const fs = require('fs').promises;
const path = require('path');

// Ensure logs directory exists
const ensureLogsDirectory = async () => {
    const logsDir = path.join(__dirname, '../logs');
    try {
        await fs.access(logsDir);
    } catch (error) {
        await fs.mkdir(logsDir, { recursive: true });
    }
};

// Initialize logs directory
ensureLogsDirectory();

// Configure main logger
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    defaultMeta: { service: 'engineering-tutor' },
    transports: [
        new winston.transports.File({ 
            filename: path.join(__dirname, '../logs/error.log'), 
            level: 'error' 
        }),
        new winston.transports.File({ 
            filename: path.join(__dirname, '../logs/combined.log') 
        }),
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        })
    ]
});

// Specialized loggers for different activities
const activityLogger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ 
            filename: path.join(__dirname, '../logs/user-activity.log') 
        })
    ]
});

const performanceLogger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ 
            filename: path.join(__dirname, '../logs/performance.log') 
        })
    ]
});

const securityLogger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ 
            filename: path.join(__dirname, '../logs/security.log') 
        })
    ]
});

class LoggingService {
    constructor() {
        this.sessionData = new Map(); // Store session-level data
        this.activityBuffer = new Map(); // Buffer activities before batch writing
        this.flushInterval = 30000; // Flush every 30 seconds
        this.startPeriodicFlush();
    }

    // Start periodic flush of buffered activities
    startPeriodicFlush() {
        setInterval(() => {
            this.flushActivityBuffer();
        }, this.flushInterval);
    }

    // Log user activity with context
    async logUserActivity(userId, action, details = {}, sessionId = null) {
        try {
            const activityData = {
                userId,
                action,
                details,
                sessionId: sessionId || this.generateSessionId(),
                timestamp: new Date(),
                userAgent: details.userAgent || 'unknown',
                ipAddress: details.ipAddress || 'unknown',
                metadata: {
                    ...details.metadata,
                    environment: process.env.NODE_ENV || 'development'
                }
            };

            // Log to activity logger
            activityLogger.info('User Activity', activityData);

            // Buffer for database update
            if (!this.activityBuffer.has(userId)) {
                this.activityBuffer.set(userId, []);
            }
            this.activityBuffer.get(userId).push({
                action,
                details,
                sessionId: activityData.sessionId,
                timestamp: activityData.timestamp,
                metadata: activityData.metadata
            });

            // Update session data
            this.updateSessionData(userId, sessionId, action, details);

            logger.info(`Activity logged for user ${userId}: ${action}`);
        } catch (error) {
            logger.error('Failed to log user activity:', error);
        }
    }

    // Log performance metrics
    logPerformance(operation, duration, metadata = {}) {
        const performanceData = {
            operation,
            duration,
            timestamp: new Date(),
            metadata: {
                ...metadata,
                memoryUsage: process.memoryUsage(),
                cpuUsage: process.cpuUsage()
            }
        };

        performanceLogger.info('Performance Metric', performanceData);
        
        // Log slow operations as warnings
        if (duration > 5000) { // 5 seconds
            logger.warn(`Slow operation detected: ${operation} took ${duration}ms`);
        }
    }

    // Log security events
    logSecurityEvent(eventType, userId, details = {}) {
        const securityData = {
            eventType,
            userId,
            details,
            timestamp: new Date(),
            severity: this.determineSeverity(eventType),
            metadata: {
                userAgent: details.userAgent || 'unknown',
                ipAddress: details.ipAddress || 'unknown'
            }
        };

        securityLogger.warn('Security Event', securityData);
        
        // Also log high-severity events to main logger
        if (securityData.severity === 'high') {
            logger.error(`High-severity security event: ${eventType} for user ${userId}`);
        }
    }

    // Log conversation interactions
    async logConversation(userId, sessionId, messageData) {
        try {
            const conversationData = {
                userId,
                sessionId,
                messageId: messageData.messageId,
                messageType: messageData.type, // 'user' or 'assistant'
                content: messageData.content,
                contentLength: messageData.content?.length || 0,
                llmModel: messageData.llmModel,
                responseTime: messageData.responseTime,
                timestamp: new Date(),
                metadata: {
                    hasAttachments: messageData.hasAttachments || false,
                    attachmentTypes: messageData.attachmentTypes || [],
                    userRating: messageData.userRating,
                    errorOccurred: messageData.errorOccurred || false
                }
            };

            await this.logUserActivity(userId, 'conversation_message', conversationData, sessionId);
            
            // Track conversation metrics
            await this.updateConversationMetrics(userId, conversationData);
        } catch (error) {
            logger.error('Failed to log conversation:', error);
        }
    }

    // Log file operations
    async logFileOperation(userId, operation, fileData) {
        try {
            const fileOperationData = {
                operation, // 'upload', 'delete', 'convert', 'process'
                fileName: fileData.fileName,
                fileSize: fileData.fileSize,
                fileType: fileData.fileType,
                processingTime: fileData.processingTime,
                success: fileData.success,
                errorMessage: fileData.errorMessage,
                metadata: fileData.metadata || {}
            };

            await this.logUserActivity(userId, `file_${operation}`, fileOperationData);
        } catch (error) {
            logger.error('Failed to log file operation:', error);
        }
    }

    // Log LLM routing decisions
    async logLLMRouting(userId, routingData) {
        try {
            const routingLogData = {
                selectedModel: routingData.selectedModel,
                requestType: routingData.requestType,
                routingReason: routingData.routingReason,
                estimatedLatency: routingData.estimatedLatency,
                actualLatency: routingData.actualLatency,
                success: routingData.success,
                userSatisfaction: routingData.userSatisfaction
            };

            await this.logUserActivity(userId, 'llm_routing', routingLogData);
            
            // Log performance metrics
            if (routingData.actualLatency) {
                this.logPerformance(`llm_${routingData.selectedModel}`, routingData.actualLatency, {
                    requestType: routingData.requestType,
                    success: routingData.success
                });
            }
        } catch (error) {
            logger.error('Failed to log LLM routing:', error);
        }
    }

    // Update session-level data
    updateSessionData(userId, sessionId, action, details) {
        const sessionKey = `${userId}_${sessionId}`;
        
        if (!this.sessionData.has(sessionKey)) {
            this.sessionData.set(sessionKey, {
                userId,
                sessionId,
                startTime: new Date(),
                lastActivity: new Date(),
                actionCount: 0,
                actions: []
            });
        }

        const session = this.sessionData.get(sessionKey);
        session.lastActivity = new Date();
        session.actionCount += 1;
        session.actions.push({ action, timestamp: new Date(), details });

        // Keep only last 50 actions to prevent memory bloat
        if (session.actions.length > 50) {
            session.actions = session.actions.slice(-50);
        }
    }

    // Flush buffered activities to database
    async flushActivityBuffer() {
        try {
            for (const [userId, activities] of this.activityBuffer.entries()) {
                if (activities.length > 0) {
                    await this.batchUpdateUserProfile(userId, activities);
                    this.activityBuffer.set(userId, []); // Clear buffer
                }
            }
        } catch (error) {
            logger.error('Failed to flush activity buffer:', error);
        }
    }

    // Batch update user profile with activities
    async batchUpdateUserProfile(userId, activities) {
        try {
            const userProfile = await UserProfile.findOne({ userId }) || 
                new UserProfile({ userId, activityLog: [] });

            // Add new activities to the log
            userProfile.activityLog.push(...activities);

            // Keep only last 1000 activities to prevent document bloat
            if (userProfile.activityLog.length > 1000) {
                userProfile.activityLog = userProfile.activityLog.slice(-1000);
            }

            await userProfile.save();
        } catch (error) {
            logger.error(`Failed to update user profile for ${userId}:`, error);
        }
    }

    // Update conversation metrics
    async updateConversationMetrics(userId, conversationData) {
        try {
            const userProfile = await UserProfile.findOne({ userId });
            if (userProfile) {
                userProfile.conversationMetrics.totalMessages += 1;
                
                // Update topic frequency if available
                if (conversationData.metadata?.topic) {
                    const topic = conversationData.metadata.topic;
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
                }

                await userProfile.save();
            }
        } catch (error) {
            logger.error('Failed to update conversation metrics:', error);
        }
    }

    // Determine security event severity
    determineSeverity(eventType) {
        const highSeverityEvents = [
            'failed_login_attempts',
            'unauthorized_access',
            'data_breach',
            'suspicious_activity'
        ];
        
        const mediumSeverityEvents = [
            'unusual_usage_pattern',
            'rate_limit_exceeded',
            'invalid_token'
        ];

        if (highSeverityEvents.includes(eventType)) return 'high';
        if (mediumSeverityEvents.includes(eventType)) return 'medium';
        return 'low';
    }

    // Generate session ID
    generateSessionId() {
        return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    // Get user activity summary
    async getUserActivitySummary(userId, timeRange = '7d') {
        try {
            const userProfile = await UserProfile.findOne({ userId });
            if (!userProfile) return null;

            const now = new Date();
            const timeRangeMs = this.parseTimeRange(timeRange);
            const startDate = new Date(now.getTime() - timeRangeMs);

            const recentActivities = userProfile.activityLog.filter(
                activity => activity.timestamp >= startDate
            );

            const summary = {
                totalActivities: recentActivities.length,
                activityBreakdown: this.groupActivitiesByType(recentActivities),
                mostActiveDay: this.findMostActiveDay(recentActivities),
                averageSessionLength: userProfile.conversationMetrics.averageSessionLength,
                topTopics: userProfile.conversationMetrics.topicFrequency
                    .sort((a, b) => b.count - a.count)
                    .slice(0, 5)
            };

            return summary;
        } catch (error) {
            logger.error('Failed to get user activity summary:', error);
            return null;
        }
    }

    // Helper methods
    parseTimeRange(timeRange) {
        const timeMap = {
            '1d': 24 * 60 * 60 * 1000,
            '7d': 7 * 24 * 60 * 60 * 1000,
            '30d': 30 * 24 * 60 * 60 * 1000,
            '90d': 90 * 24 * 60 * 60 * 1000
        };
        return timeMap[timeRange] || timeMap['7d'];
    }

    groupActivitiesByType(activities) {
        return activities.reduce((acc, activity) => {
            acc[activity.action] = (acc[activity.action] || 0) + 1;
            return acc;
        }, {});
    }

    findMostActiveDay(activities) {
        const dayCount = activities.reduce((acc, activity) => {
            const day = activity.timestamp.toDateString();
            acc[day] = (acc[day] || 0) + 1;
            return acc;
        }, {});

        return Object.entries(dayCount)
            .sort(([,a], [,b]) => b - a)[0]?.[0] || null;
    }

    // Cleanup old logs (called periodically)
    async cleanupOldLogs(retentionDays = 90) {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

            // Clean up user profiles activity logs
            await UserProfile.updateMany(
                {},
                {
                    $pull: {
                        activityLog: { timestamp: { $lt: cutoffDate } }
                    }
                }
            );

            logger.info(`Cleaned up activity logs older than ${retentionDays} days`);
        } catch (error) {
            logger.error('Failed to cleanup old logs:', error);
        }
    }
}

module.exports = new LoggingService();