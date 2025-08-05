const mongoose = require('mongoose');

const contentGenerationSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    requestId: {
        type: String,
        required: true,
        unique: true
    },
    contentType: {
        type: String,
        enum: ['report', 'presentation', 'podcast', 'summary', 'mindmap'],
        required: true
    },
    topic: {
        type: String,
        required: true
    },
    parameters: {
        length: {
            type: String,
            enum: ['short', 'medium', 'long', 'comprehensive'],
            default: 'medium'
        },
        style: {
            type: String,
            enum: ['academic', 'casual', 'professional', 'educational'],
            default: 'educational'
        },
        targetAudience: {
            type: String,
            enum: ['beginner', 'intermediate', 'advanced', 'expert'],
            default: 'intermediate'
        },
        includeReferences: { type: Boolean, default: true },
        includeImages: { type: Boolean, default: false },
        language: { type: String, default: 'en' }
    },
    sources: [{
        type: {
            type: String,
            enum: ['web', 'document', 'video', 'audio', 'database']
        },
        url: String,
        title: String,
        content: String,
        relevanceScore: Number,
        extractedAt: Date
    }],
    generatedContent: {
        text: String,
        htmlContent: String,
        audioFile: String,
        presentationFile: String,
        metadata: mongoose.Schema.Types.Mixed
    },
    status: {
        type: String,
        enum: ['pending', 'processing', 'completed', 'failed'],
        default: 'pending'
    },
    progress: {
        currentStep: String,
        percentage: { type: Number, default: 0 },
        estimatedTimeRemaining: Number,
        steps: [{
            name: String,
            status: {
                type: String,
                enum: ['pending', 'processing', 'completed', 'failed'],
                default: 'pending'
            },
            startTime: Date,
            endTime: Date,
            details: String
        }]
    },
    qualityMetrics: {
        coherenceScore: Number,
        relevanceScore: Number,
        originalityScore: Number,
        readabilityScore: Number,
        userRating: Number,
        userFeedback: String
    },
    processingTime: {
        startTime: Date,
        endTime: Date,
        totalDuration: Number
    }
}, {
    timestamps: true
});

// Indexes for efficient queries
contentGenerationSchema.index({ userId: 1, createdAt: -1 });
contentGenerationSchema.index({ requestId: 1 });
contentGenerationSchema.index({ status: 1 });
contentGenerationSchema.index({ contentType: 1 });

module.exports = mongoose.model('ContentGeneration', contentGenerationSchema);