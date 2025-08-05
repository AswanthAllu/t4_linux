const mongoose = require('mongoose');

const llmModelSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        unique: true
    },
    type: {
        type: String,
        enum: ['llama', 'deepseek', 'qwen', 'gemini', 'custom'],
        required: true
    },
    version: {
        type: String,
        required: true
    },
    specialization: {
        type: String,
        enum: ['chat', 'reasoning', 'technical', 'creative', 'academic'],
        required: true
    },
    configuration: {
        apiEndpoint: String,
        apiKey: String,
        maxTokens: { type: Number, default: 4096 },
        temperature: { type: Number, default: 0.7 },
        topP: { type: Number, default: 0.9 },
        frequencyPenalty: { type: Number, default: 0 },
        presencePenalty: { type: Number, default: 0 }
    },
    performance: {
        averageLatency: { type: Number, default: 0 },
        successRate: { type: Number, default: 100 },
        userSatisfaction: { type: Number, default: 5 },
        totalRequests: { type: Number, default: 0 },
        errorCount: { type: Number, default: 0 }
    },
    trainingData: {
        subjects: [String],
        lastTrainingDate: Date,
        trainingDataSize: { type: Number, default: 0 },
        customDatasets: [{
            name: String,
            description: String,
            size: Number,
            uploadDate: Date,
            filePath: String
        }]
    },
    capabilities: {
        supportsMultimodal: { type: Boolean, default: false },
        supportsFunctionCalling: { type: Boolean, default: false },
        supportsStreaming: { type: Boolean, default: false },
        maxContextLength: { type: Number, default: 4096 },
        supportedLanguages: [String]
    },
    isActive: {
        type: Boolean,
        default: true
    },
    usageRules: {
        maxRequestsPerHour: { type: Number, default: 1000 },
        allowedUserTypes: [String],
        costPerRequest: { type: Number, default: 0 }
    }
}, {
    timestamps: true
});

// Indexes for efficient queries
llmModelSchema.index({ type: 1, specialization: 1 });
llmModelSchema.index({ isActive: 1 });
llmModelSchema.index({ 'performance.averageLatency': 1 });

module.exports = mongoose.model('LLMModel', llmModelSchema);