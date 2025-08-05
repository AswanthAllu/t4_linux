const LLMModel = require('../models/LLMModel');
const UserProfile = require('../models/UserProfile');
const winston = require('winston');

// Configure logger
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ filename: 'logs/llm-router.log' }),
        new winston.transports.Console()
    ]
});

class MultiLLMRouter {
    constructor() {
        this.llmModels = new Map();
        this.loadBalancer = new Map();
        this.initializeModels();
    }

    async initializeModels() {
        try {
            const models = await LLMModel.find({ isActive: true });
            models.forEach(model => {
                this.llmModels.set(model.name, model);
                this.loadBalancer.set(model.name, 0);
            });
            logger.info(`Initialized ${models.length} LLM models`);
        } catch (error) {
            logger.error('Failed to initialize LLM models:', error);
        }
    }

    async routeRequest(requestType, content, userId, context = {}) {
        try {
            const userProfile = await UserProfile.findOne({ userId });
            const selectedModel = await this.selectOptimalModel(
                requestType, 
                content, 
                userProfile, 
                context
            );

            if (!selectedModel) {
                throw new Error('No suitable LLM model found for request');
            }

            // Update load balancer
            this.loadBalancer.set(selectedModel.name, 
                this.loadBalancer.get(selectedModel.name) + 1
            );

            logger.info(`Routing ${requestType} request to ${selectedModel.name} for user ${userId}`);
            
            return {
                model: selectedModel,
                routingReason: this.getRoutingReason(requestType, selectedModel),
                estimatedLatency: selectedModel.performance.averageLatency
            };
        } catch (error) {
            logger.error('Error in request routing:', error);
            throw error;
        }
    }

    async selectOptimalModel(requestType, content, userProfile, context) {
        const criteria = this.analyzeRequestCriteria(requestType, content, context);
        const availableModels = Array.from(this.llmModels.values());
        
        // Score each model based on criteria
        const modelScores = availableModels.map(model => ({
            model,
            score: this.calculateModelScore(model, criteria, userProfile)
        }));

        // Sort by score and select the best
        modelScores.sort((a, b) => b.score - a.score);
        
        return modelScores.length > 0 ? modelScores[0].model : null;
    }

    analyzeRequestCriteria(requestType, content, context) {
        const criteria = {
            type: requestType,
            complexity: this.assessComplexity(content),
            domain: this.identifyDomain(content),
            requiresReasoning: this.requiresReasoning(content),
            isConversational: this.isConversational(requestType),
            isTechnical: this.isTechnical(content),
            requiresCreativity: this.requiresCreativity(requestType),
            contentLength: content.length,
            urgency: context.urgency || 'normal'
        };

        return criteria;
    }

    calculateModelScore(model, criteria, userProfile) {
        let score = 0;

        // Base specialization matching
        switch (criteria.type) {
            case 'chat':
            case 'conversation':
                if (model.specialization === 'chat') score += 50;
                break;
            case 'reasoning':
            case 'analysis':
            case 'problem_solving':
                if (model.specialization === 'reasoning') score += 50;
                break;
            case 'technical':
            case 'code':
            case 'engineering':
                if (model.specialization === 'technical') score += 50;
                break;
            case 'creative':
            case 'content_generation':
                if (model.specialization === 'creative') score += 50;
                break;
            case 'academic':
            case 'educational':
                if (model.specialization === 'academic') score += 50;
                break;
        }

        // Performance factors
        score += (100 - model.performance.averageLatency / 10); // Lower latency = higher score
        score += model.performance.successRate * 0.3;
        score += model.performance.userSatisfaction * 10;

        // User preference
        if (userProfile && userProfile.preferences.preferredLLM === model.type) {
            score += 20;
        }

        // Load balancing (prefer less loaded models)
        const currentLoad = this.loadBalancer.get(model.name) || 0;
        score -= currentLoad * 2;

        // Context length requirements
        if (criteria.contentLength > model.capabilities.maxContextLength) {
            score -= 100; // Heavily penalize if content exceeds capacity
        }

        return score;
    }

    assessComplexity(content) {
        const complexityIndicators = [
            /\b(analyze|compare|evaluate|synthesize|integrate)\b/gi,
            /\b(algorithm|equation|formula|theorem)\b/gi,
            /\b(hypothesis|methodology|framework)\b/gi
        ];

        let complexityScore = 0;
        complexityIndicators.forEach(pattern => {
            const matches = content.match(pattern);
            if (matches) complexityScore += matches.length;
        });

        if (complexityScore > 5) return 'high';
        if (complexityScore > 2) return 'medium';
        return 'low';
    }

    identifyDomain(content) {
        const domainPatterns = {
            engineering: /\b(engineering|mechanical|electrical|civil|software|design|circuit|system)\b/gi,
            mathematics: /\b(math|calculus|algebra|geometry|statistics|equation|theorem)\b/gi,
            science: /\b(physics|chemistry|biology|research|experiment|hypothesis)\b/gi,
            programming: /\b(code|programming|algorithm|function|variable|loop|array)\b/gi,
            business: /\b(business|marketing|finance|management|strategy|revenue)\b/gi
        };

        for (const [domain, pattern] of Object.entries(domainPatterns)) {
            if (pattern.test(content)) return domain;
        }

        return 'general';
    }

    requiresReasoning(content) {
        const reasoningKeywords = /\b(why|how|analyze|explain|compare|evaluate|reason|logic|cause|effect)\b/gi;
        return reasoningKeywords.test(content);
    }

    isConversational(requestType) {
        return ['chat', 'conversation', 'casual'].includes(requestType);
    }

    isTechnical(content) {
        const technicalKeywords = /\b(technical|specification|implementation|architecture|protocol|algorithm)\b/gi;
        return technicalKeywords.test(content);
    }

    requiresCreativity(requestType) {
        return ['creative', 'content_generation', 'story', 'poem', 'presentation'].includes(requestType);
    }

    getRoutingReason(requestType, selectedModel) {
        return `Selected ${selectedModel.name} (${selectedModel.type}) for ${requestType} based on specialization: ${selectedModel.specialization}`;
    }

    async updateModelPerformance(modelName, metrics) {
        try {
            const model = await LLMModel.findOne({ name: modelName });
            if (model) {
                // Update performance metrics
                model.performance.totalRequests += 1;
                model.performance.averageLatency = 
                    (model.performance.averageLatency * (model.performance.totalRequests - 1) + metrics.latency) / 
                    model.performance.totalRequests;
                
                if (metrics.success) {
                    model.performance.successRate = 
                        (model.performance.successRate * (model.performance.totalRequests - 1) + 100) / 
                        model.performance.totalRequests;
                } else {
                    model.performance.errorCount += 1;
                    model.performance.successRate = 
                        (model.performance.successRate * (model.performance.totalRequests - 1)) / 
                        model.performance.totalRequests;
                }

                if (metrics.userRating) {
                    model.performance.userSatisfaction = 
                        (model.performance.userSatisfaction * (model.performance.totalRequests - 1) + metrics.userRating) / 
                        model.performance.totalRequests;
                }

                await model.save();
                logger.info(`Updated performance metrics for ${modelName}`);
            }
        } catch (error) {
            logger.error(`Failed to update performance for ${modelName}:`, error);
        }
    }

    async getModelStatus() {
        const models = Array.from(this.llmModels.values());
        return models.map(model => ({
            name: model.name,
            type: model.type,
            specialization: model.specialization,
            isActive: model.isActive,
            currentLoad: this.loadBalancer.get(model.name) || 0,
            performance: model.performance
        }));
    }
}

module.exports = new MultiLLMRouter();