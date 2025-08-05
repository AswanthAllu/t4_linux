const mongoose = require('mongoose');

const userProfileSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true
    },
    preferences: {
        preferredLLM: {
            type: String,
            enum: ['llama', 'deepseek', 'qwen', 'gemini'],
            default: 'gemini'
        },
        learningStyle: {
            type: String,
            enum: ['visual', 'auditory', 'kinesthetic', 'reading'],
            default: 'visual'
        },
        subjects: [{
            name: String,
            proficiencyLevel: {
                type: String,
                enum: ['beginner', 'intermediate', 'advanced'],
                default: 'beginner'
            },
            interests: [String]
        }],
        language: {
            type: String,
            default: 'en'
        },
        timezone: {
            type: String,
            default: 'UTC'
        }
    },
    conversationMetrics: {
        totalSessions: { type: Number, default: 0 },
        totalMessages: { type: Number, default: 0 },
        averageSessionLength: { type: Number, default: 0 },
        topicFrequency: [{
            topic: String,
            count: Number,
            lastUsed: Date
        }],
        preferredResponseLength: {
            type: String,
            enum: ['brief', 'detailed', 'comprehensive'],
            default: 'detailed'
        }
    },
    learningProgress: {
        completedTopics: [String],
        currentGoals: [String],
        studyStreak: { type: Number, default: 0 },
        lastStudyDate: Date,
        achievements: [{
            name: String,
            description: String,
            earnedDate: Date,
            category: String
        }]
    },
    activityLog: [{
        action: String,
        details: mongoose.Schema.Types.Mixed,
        timestamp: { type: Date, default: Date.now },
        sessionId: String,
        metadata: mongoose.Schema.Types.Mixed
    }]
}, {
    timestamps: true
});

// Index for efficient queries
userProfileSchema.index({ userId: 1 });
userProfileSchema.index({ 'activityLog.timestamp': -1 });
userProfileSchema.index({ 'conversationMetrics.topicFrequency.topic': 1 });

module.exports = mongoose.model('UserProfile', userProfileSchema);