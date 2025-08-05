const LLMModel = require('../models/LLMModel');
const UserProfile = require('../models/UserProfile');
const ChatSession = require('../models/ChatSession');
const loggingService = require('./loggingService');
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
        new winston.transports.File({ filename: 'logs/llm-trainer.log' }),
        new winston.transports.Console()
    ]
});

class LLMTrainer {
    constructor() {
        this.trainingJobs = new Map();
        this.trainingDataDirectory = path.join(__dirname, '../training_data');
        this.modelDirectory = path.join(__dirname, '../trained_models');
        this.subjects = this.initializeSubjects();
        this.ensureDirectories();
    }

    async ensureDirectories() {
        try {
            await fs.access(this.trainingDataDirectory);
        } catch (error) {
            await fs.mkdir(this.trainingDataDirectory, { recursive: true });
        }

        try {
            await fs.access(this.modelDirectory);
        } catch (error) {
            await fs.mkdir(this.modelDirectory, { recursive: true });
        }
    }

    initializeSubjects() {
        return {
            'mechanical_engineering': {
                name: 'Mechanical Engineering',
                keywords: ['mechanics', 'thermodynamics', 'fluid dynamics', 'materials', 'manufacturing', 'CAD', 'FEA'],
                baseModel: 'qwen',
                specialization: 'technical',
                trainingWeight: 0.25
            },
            'electrical_engineering': {
                name: 'Electrical Engineering',
                keywords: ['circuits', 'electronics', 'power systems', 'signals', 'control systems', 'microprocessors'],
                baseModel: 'qwen',
                specialization: 'technical',
                trainingWeight: 0.25
            },
            'computer_science': {
                name: 'Computer Science',
                keywords: ['algorithms', 'data structures', 'programming', 'software engineering', 'databases', 'AI', 'ML'],
                baseModel: 'llama',
                specialization: 'technical',
                trainingWeight: 0.25
            },
            'mathematics': {
                name: 'Mathematics',
                keywords: ['calculus', 'algebra', 'geometry', 'statistics', 'differential equations', 'linear algebra'],
                baseModel: 'deepseek',
                specialization: 'reasoning',
                trainingWeight: 0.15
            },
            'physics': {
                name: 'Physics',
                keywords: ['mechanics', 'electromagnetism', 'quantum', 'thermodynamics', 'optics', 'relativity'],
                baseModel: 'deepseek',
                specialization: 'reasoning',
                trainingWeight: 0.15
            },
            'chemistry': {
                name: 'Chemistry',
                keywords: ['organic', 'inorganic', 'physical chemistry', 'biochemistry', 'analytical', 'reactions'],
                baseModel: 'gemini',
                specialization: 'academic',
                trainingWeight: 0.1
            },
            'general_engineering': {
                name: 'General Engineering',
                keywords: ['engineering', 'design', 'problem solving', 'analysis', 'optimization', 'systems'],
                baseModel: 'gemini',
                specialization: 'academic',
                trainingWeight: 0.1
            }
        };
    }

    // Start training a subject-specific model
    async startTraining(subject, options = {}) {
        try {
            const jobId = uuidv4();
            const subjectConfig = this.subjects[subject];
            
            if (!subjectConfig) {
                throw new Error(`Unknown subject: ${subject}`);
            }

            const trainingJob = {
                jobId,
                subject,
                config: subjectConfig,
                status: 'preparing',
                startTime: new Date(),
                options: {
                    maxDataPoints: options.maxDataPoints || 10000,
                    trainingEpochs: options.trainingEpochs || 3,
                    learningRate: options.learningRate || 0.0001,
                    batchSize: options.batchSize || 16,
                    validationSplit: options.validationSplit || 0.2,
                    ...options
                },
                progress: {
                    currentStep: 'Initializing',
                    percentage: 0,
                    estimatedTimeRemaining: 0
                },
                metrics: {
                    dataPoints: 0,
                    trainingLoss: 0,
                    validationLoss: 0,
                    accuracy: 0
                }
            };

            this.trainingJobs.set(jobId, trainingJob);

            // Start the training process asynchronously
            this.processTraining(jobId);

            logger.info(`Started training job ${jobId} for subject ${subject}`);

            return {
                jobId,
                status: 'started',
                estimatedTime: this.estimateTrainingTime(subject, trainingJob.options),
                message: `Started training ${subjectConfig.name} specialist model`
            };

        } catch (error) {
            logger.error('Failed to start training:', error);
            throw error;
        }
    }

    // Process the training job
    async processTraining(jobId) {
        try {
            const job = this.trainingJobs.get(jobId);
            if (!job) return;

            // Step 1: Collect training data
            await this.updateTrainingProgress(jobId, 'collecting_data', 10);
            const trainingData = await this.collectTrainingData(job.subject, job.options);
            job.metrics.dataPoints = trainingData.length;

            // Step 2: Prepare training dataset
            await this.updateTrainingProgress(jobId, 'preparing_dataset', 25);
            const dataset = await this.prepareDataset(trainingData, job.options);

            // Step 3: Initialize model
            await this.updateTrainingProgress(jobId, 'initializing_model', 35);
            const modelConfig = await this.initializeModel(job.subject, job.config);

            // Step 4: Train the model
            await this.updateTrainingProgress(jobId, 'training', 40);
            const trainingResults = await this.trainModel(modelConfig, dataset, job.options, jobId);

            // Step 5: Validate the model
            await this.updateTrainingProgress(jobId, 'validating', 80);
            const validationResults = await this.validateModel(modelConfig, dataset.validation);

            // Step 6: Save the trained model
            await this.updateTrainingProgress(jobId, 'saving', 90);
            const savedModel = await this.saveTrainedModel(jobId, modelConfig, trainingResults, validationResults);

            // Step 7: Register the model
            await this.updateTrainingProgress(jobId, 'registering', 95);
            await this.registerTrainedModel(savedModel, job);

            await this.updateTrainingProgress(jobId, 'completed', 100);

            // Update job status
            job.status = 'completed';
            job.endTime = new Date();
            job.metrics = {
                ...job.metrics,
                ...trainingResults.metrics,
                ...validationResults.metrics
            };

            logger.info(`Training job ${jobId} completed successfully`);

        } catch (error) {
            logger.error(`Training job ${jobId} failed:`, error);
            
            const job = this.trainingJobs.get(jobId);
            if (job) {
                job.status = 'failed';
                job.error = error.message;
                job.endTime = new Date();
            }
        }
    }

    // Collect training data for a subject
    async collectTrainingData(subject, options) {
        try {
            const subjectConfig = this.subjects[subject];
            const trainingData = [];

            // Collect data from chat sessions
            const chatData = await this.collectChatData(subject, subjectConfig.keywords, options.maxDataPoints * 0.6);
            trainingData.push(...chatData);

            // Collect data from uploaded documents
            const documentData = await this.collectDocumentData(subject, subjectConfig.keywords, options.maxDataPoints * 0.2);
            trainingData.push(...documentData);

            // Collect data from web sources
            const webData = await this.collectWebData(subject, subjectConfig.keywords, options.maxDataPoints * 0.2);
            trainingData.push(...webData);

            // Filter and clean the data
            const cleanedData = this.cleanTrainingData(trainingData, subjectConfig);

            return cleanedData.slice(0, options.maxDataPoints);

        } catch (error) {
            logger.error('Failed to collect training data:', error);
            return [];
        }
    }

    // Collect training data from chat sessions
    async collectChatData(subject, keywords, maxPoints) {
        try {
            const chatSessions = await ChatSession.find({
                'messages.content': { 
                    $regex: keywords.join('|'), 
                    $options: 'i' 
                }
            }).limit(Math.ceil(maxPoints / 10)).lean();

            const trainingExamples = [];

            for (const session of chatSessions) {
                for (let i = 0; i < session.messages.length - 1; i++) {
                    const userMessage = session.messages[i];
                    const assistantMessage = session.messages[i + 1];

                    if (userMessage.sender === 'user' && assistantMessage.sender === 'assistant') {
                        // Check if the conversation is relevant to the subject
                        const relevance = this.calculateRelevance(
                            userMessage.content + ' ' + assistantMessage.content,
                            keywords
                        );

                        if (relevance > 0.3) {
                            trainingExamples.push({
                                input: userMessage.content,
                                output: assistantMessage.content,
                                relevance,
                                source: 'chat',
                                metadata: {
                                    sessionId: session._id,
                                    timestamp: userMessage.timestamp
                                }
                            });
                        }
                    }
                }
            }

            return trainingExamples.slice(0, maxPoints);

        } catch (error) {
            logger.error('Failed to collect chat data:', error);
            return [];
        }
    }

    // Collect training data from documents
    async collectDocumentData(subject, keywords, maxPoints) {
        try {
            // This would collect data from uploaded documents
            // For now, returning empty array as it requires file processing integration
            return [];

        } catch (error) {
            logger.error('Failed to collect document data:', error);
            return [];
        }
    }

    // Collect training data from web sources
    async collectWebData(subject, keywords, maxPoints) {
        try {
            // This would collect relevant educational content from web sources
            // For now, returning empty array as it requires web scraping integration
            return [];

        } catch (error) {
            logger.error('Failed to collect web data:', error);
            return [];
        }
    }

    // Clean and filter training data
    cleanTrainingData(data, subjectConfig) {
        return data
            .filter(item => item.input && item.output)
            .filter(item => item.input.length > 10 && item.output.length > 20)
            .filter(item => item.relevance > 0.2)
            .map(item => ({
                ...item,
                input: this.cleanText(item.input),
                output: this.cleanText(item.output)
            }))
            .sort((a, b) => b.relevance - a.relevance);
    }

    // Clean text data
    cleanText(text) {
        return text
            .replace(/\s+/g, ' ')
            .replace(/[^\w\s.,;:!?()-]/g, '')
            .trim()
            .substring(0, 2000);
    }

    // Calculate relevance score
    calculateRelevance(text, keywords) {
        const lowercaseText = text.toLowerCase();
        let score = 0;
        
        keywords.forEach(keyword => {
            const occurrences = (lowercaseText.match(new RegExp(keyword.toLowerCase(), 'g')) || []).length;
            score += occurrences * 0.1;
        });

        return Math.min(score, 1.0);
    }

    // Prepare dataset for training
    async prepareDataset(trainingData, options) {
        try {
            // Shuffle the data
            const shuffledData = this.shuffleArray([...trainingData]);

            // Split into training and validation sets
            const splitIndex = Math.floor(shuffledData.length * (1 - options.validationSplit));
            
            const dataset = {
                training: shuffledData.slice(0, splitIndex),
                validation: shuffledData.slice(splitIndex),
                metadata: {
                    totalExamples: shuffledData.length,
                    trainingExamples: splitIndex,
                    validationExamples: shuffledData.length - splitIndex,
                    averageInputLength: this.calculateAverageLength(shuffledData, 'input'),
                    averageOutputLength: this.calculateAverageLength(shuffledData, 'output')
                }
            };

            // Save dataset to file
            const datasetPath = path.join(this.trainingDataDirectory, `dataset_${Date.now()}.json`);
            await fs.writeFile(datasetPath, JSON.stringify(dataset, null, 2));

            return dataset;

        } catch (error) {
            logger.error('Failed to prepare dataset:', error);
            throw error;
        }
    }

    // Initialize model configuration
    async initializeModel(subject, subjectConfig) {
        try {
            const modelConfig = {
                name: `${subject}_specialist_${Date.now()}`,
                baseModel: subjectConfig.baseModel,
                subject,
                specialization: subjectConfig.specialization,
                configuration: {
                    maxTokens: 2048,
                    temperature: 0.7,
                    topP: 0.9,
                    frequencyPenalty: 0.1,
                    presencePenalty: 0.1
                },
                trainingConfig: {
                    architecture: 'fine-tuned-transformer',
                    layers: 12,
                    attentionHeads: 8,
                    hiddenSize: 768,
                    vocabularySize: 50000
                }
            };

            return modelConfig;

        } catch (error) {
            logger.error('Failed to initialize model:', error);
            throw error;
        }
    }

    // Train the model (placeholder implementation)
    async trainModel(modelConfig, dataset, options, jobId) {
        try {
            // This is a placeholder implementation
            // In a real scenario, this would integrate with actual ML training frameworks
            
            const trainingResults = {
                modelPath: path.join(this.modelDirectory, `${modelConfig.name}.model`),
                metrics: {
                    trainingLoss: 0.5,
                    trainingAccuracy: 0.85,
                    epochs: options.trainingEpochs,
                    learningRate: options.learningRate,
                    batchSize: options.batchSize
                },
                trainingTime: 3600000 // 1 hour placeholder
            };

            // Simulate training progress
            for (let epoch = 1; epoch <= options.trainingEpochs; epoch++) {
                await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate training time
                
                const progress = 40 + (30 * epoch / options.trainingEpochs);
                await this.updateTrainingProgress(jobId, `training_epoch_${epoch}`, progress);
                
                logger.info(`Training epoch ${epoch}/${options.trainingEpochs} completed`);
            }

            // Save model metadata
            const modelMetadata = {
                ...modelConfig,
                trainingResults,
                createdAt: new Date()
            };

            const metadataPath = path.join(this.modelDirectory, `${modelConfig.name}_metadata.json`);
            await fs.writeFile(metadataPath, JSON.stringify(modelMetadata, null, 2));

            return trainingResults;

        } catch (error) {
            logger.error('Failed to train model:', error);
            throw error;
        }
    }

    // Validate the trained model
    async validateModel(modelConfig, validationData) {
        try {
            // Placeholder validation implementation
            const validationResults = {
                metrics: {
                    validationLoss: 0.6,
                    validationAccuracy: 0.82,
                    perplexity: 15.2,
                    bleuScore: 0.75
                },
                samplePredictions: validationData.slice(0, 5).map(item => ({
                    input: item.input,
                    expected: item.output,
                    predicted: `Predicted response for: ${item.input.substring(0, 50)}...`
                }))
            };

            return validationResults;

        } catch (error) {
            logger.error('Failed to validate model:', error);
            throw error;
        }
    }

    // Save the trained model
    async saveTrainedModel(jobId, modelConfig, trainingResults, validationResults) {
        try {
            const savedModel = {
                jobId,
                name: modelConfig.name,
                subject: modelConfig.subject,
                baseModel: modelConfig.baseModel,
                specialization: modelConfig.specialization,
                modelPath: trainingResults.modelPath,
                configuration: modelConfig.configuration,
                performance: {
                    ...trainingResults.metrics,
                    ...validationResults.metrics
                },
                createdAt: new Date(),
                version: '1.0.0',
                status: 'trained'
            };

            // Save model info to file
            const modelInfoPath = path.join(this.modelDirectory, `${modelConfig.name}_info.json`);
            await fs.writeFile(modelInfoPath, JSON.stringify(savedModel, null, 2));

            return savedModel;

        } catch (error) {
            logger.error('Failed to save trained model:', error);
            throw error;
        }
    }

    // Register the trained model in the database
    async registerTrainedModel(savedModel, trainingJob) {
        try {
            const llmModel = new LLMModel({
                name: savedModel.name,
                type: 'custom',
                version: savedModel.version,
                specialization: savedModel.specialization,
                configuration: {
                    ...savedModel.configuration,
                    modelPath: savedModel.modelPath
                },
                performance: {
                    averageLatency: 2000, // Placeholder
                    successRate: savedModel.performance.validationAccuracy * 100,
                    userSatisfaction: 4.5,
                    totalRequests: 0,
                    errorCount: 0
                },
                trainingData: {
                    subjects: [trainingJob.subject],
                    lastTrainingDate: new Date(),
                    trainingDataSize: trainingJob.metrics.dataPoints,
                    customDatasets: [{
                        name: `${trainingJob.subject}_dataset`,
                        description: `Training dataset for ${trainingJob.config.name}`,
                        size: trainingJob.metrics.dataPoints,
                        uploadDate: new Date(),
                        filePath: savedModel.modelPath
                    }]
                },
                capabilities: {
                    supportsMultimodal: false,
                    supportsFunctionCalling: true,
                    supportsStreaming: false,
                    maxContextLength: savedModel.configuration.maxTokens,
                    supportedLanguages: ['en']
                },
                isActive: true,
                usageRules: {
                    maxRequestsPerHour: 100,
                    allowedUserTypes: ['student', 'educator'],
                    costPerRequest: 0.01
                }
            });

            await llmModel.save();

            logger.info(`Registered trained model ${savedModel.name} in database`);

            return llmModel;

        } catch (error) {
            logger.error('Failed to register trained model:', error);
            throw error;
        }
    }

    // Update training progress
    async updateTrainingProgress(jobId, currentStep, percentage) {
        try {
            const job = this.trainingJobs.get(jobId);
            if (job) {
                job.progress.currentStep = currentStep;
                job.progress.percentage = percentage;
                job.progress.estimatedTimeRemaining = this.calculateRemainingTime(job, percentage);
                
                logger.info(`Training job ${jobId}: ${currentStep} (${percentage}%)`);
            }
        } catch (error) {
            logger.error('Failed to update training progress:', error);
        }
    }

    // Utility methods
    shuffleArray(array) {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }

    calculateAverageLength(data, field) {
        if (data.length === 0) return 0;
        const totalLength = data.reduce((sum, item) => sum + (item[field]?.length || 0), 0);
        return Math.round(totalLength / data.length);
    }

    estimateTrainingTime(subject, options) {
        const baseTime = 3600; // 1 hour base time
        const dataMultiplier = options.maxDataPoints / 1000;
        const epochMultiplier = options.trainingEpochs;
        
        return Math.round(baseTime * dataMultiplier * epochMultiplier);
    }

    calculateRemainingTime(job, currentPercentage) {
        if (currentPercentage === 0) return job.estimatedTime || 3600;
        
        const elapsed = Date.now() - job.startTime.getTime();
        const totalEstimated = (elapsed / currentPercentage) * 100;
        
        return Math.max(0, Math.round((totalEstimated - elapsed) / 1000));
    }

    // Get training job status
    getTrainingStatus(jobId) {
        const job = this.trainingJobs.get(jobId);
        if (!job) return null;

        return {
            jobId: job.jobId,
            subject: job.subject,
            status: job.status,
            progress: job.progress,
            metrics: job.metrics,
            startTime: job.startTime,
            endTime: job.endTime,
            error: job.error
        };
    }

    // List all available subjects for training
    getAvailableSubjects() {
        return Object.entries(this.subjects).map(([key, config]) => ({
            id: key,
            name: config.name,
            keywords: config.keywords,
            baseModel: config.baseModel,
            specialization: config.specialization,
            trainingWeight: config.trainingWeight
        }));
    }

    // Get trained models for a subject
    async getTrainedModels(subject) {
        try {
            const models = await LLMModel.find({
                type: 'custom',
                'trainingData.subjects': subject,
                isActive: true
            });

            return models.map(model => ({
                name: model.name,
                version: model.version,
                performance: model.performance,
                trainingDate: model.trainingData.lastTrainingDate,
                dataSize: model.trainingData.trainingDataSize
            }));

        } catch (error) {
            logger.error('Failed to get trained models:', error);
            return [];
        }
    }

    // Delete a training job
    deleteTrainingJob(jobId) {
        return this.trainingJobs.delete(jobId);
    }

    // Get training statistics
    async getTrainingStatistics() {
        try {
            const customModels = await LLMModel.find({ type: 'custom' });
            const activeJobs = Array.from(this.trainingJobs.values()).filter(job => 
                job.status === 'preparing' || job.status === 'training'
            );

            return {
                totalCustomModels: customModels.length,
                activeTrainingJobs: activeJobs.length,
                completedJobs: Array.from(this.trainingJobs.values()).filter(job => 
                    job.status === 'completed'
                ).length,
                failedJobs: Array.from(this.trainingJobs.values()).filter(job => 
                    job.status === 'failed'
                ).length,
                subjectDistribution: this.getSubjectDistribution(customModels),
                averageTrainingTime: this.calculateAverageTrainingTime(),
                totalDataPoints: customModels.reduce((sum, model) => 
                    sum + (model.trainingData.trainingDataSize || 0), 0
                )
            };

        } catch (error) {
            logger.error('Failed to get training statistics:', error);
            return {};
        }
    }

    getSubjectDistribution(models) {
        const distribution = {};
        models.forEach(model => {
            model.trainingData.subjects.forEach(subject => {
                distribution[subject] = (distribution[subject] || 0) + 1;
            });
        });
        return distribution;
    }

    calculateAverageTrainingTime() {
        const completedJobs = Array.from(this.trainingJobs.values()).filter(job => 
            job.status === 'completed' && job.endTime && job.startTime
        );

        if (completedJobs.length === 0) return 0;

        const totalTime = completedJobs.reduce((sum, job) => 
            sum + (job.endTime.getTime() - job.startTime.getTime()), 0
        );

        return Math.round(totalTime / completedJobs.length / 1000); // seconds
    }
}

module.exports = new LLMTrainer();