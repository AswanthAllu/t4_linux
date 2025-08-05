const express = require('express');
const router = express.Router();
const multiLLMRouter = require('../services/multiLLMRouter');
const advancedContentGenerator = require('../services/advancedContentGenerator');
const multimodalScraper = require('../services/multimodalScraper');
const loggingService = require('../services/loggingService');
const personalizationEngine = require('../services/personalizationEngine');
const llmTrainer = require('../services/llmTrainer');
const enhancedGeminiService = require('../services/enhancedGeminiService');
const mcpProtocol = require('../services/mcpProtocol');

// Multi-LLM Router endpoints
router.get('/llm/models', async (req, res) => {
    try {
        const models = await multiLLMRouter.getModelStatus();
        res.json({
            success: true,
            models
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.post('/llm/route', async (req, res) => {
    try {
        const { requestType, content, userId, context } = req.body;
        
        if (!requestType || !content || !userId) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: requestType, content, userId'
            });
        }

        const routing = await multiLLMRouter.routeRequest(requestType, content, userId, context);
        
        res.json({
            success: true,
            routing
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Content Generation endpoints
router.post('/content/generate', async (req, res) => {
    try {
        const { userId, contentType, topic, parameters } = req.body;
        
        if (!userId || !contentType || !topic) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: userId, contentType, topic'
            });
        }

        const result = await advancedContentGenerator.generateContent(
            userId, 
            contentType, 
            topic, 
            parameters
        );
        
        res.json({
            success: true,
            ...result
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.get('/content/status/:requestId', async (req, res) => {
    try {
        const { requestId } = req.params;
        const status = await advancedContentGenerator.getGenerationStatus(requestId);
        
        if (!status) {
            return res.status(404).json({
                success: false,
                error: 'Generation request not found'
            });
        }

        res.json({
            success: true,
            status
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.get('/content/result/:requestId', async (req, res) => {
    try {
        const { requestId } = req.params;
        const content = await advancedContentGenerator.getGeneratedContent(requestId);
        
        if (!content) {
            return res.status(404).json({
                success: false,
                error: 'Generated content not found or not ready'
            });
        }

        res.json({
            success: true,
            content
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Multimodal Scraper endpoints
router.post('/scraper/search', async (req, res) => {
    try {
        const { query, options } = req.body;
        
        if (!query) {
            return res.status(400).json({
                success: false,
                error: 'Missing required field: query'
            });
        }

        const results = await multimodalScraper.searchWeb(query, options);
        
        res.json({
            success: true,
            results,
            count: results.length
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.post('/scraper/academic', async (req, res) => {
    try {
        const { query, options } = req.body;
        
        if (!query) {
            return res.status(400).json({
                success: false,
                error: 'Missing required field: query'
            });
        }

        const results = await multimodalScraper.searchAcademic(query, options);
        
        res.json({
            success: true,
            results,
            count: results.length
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.post('/scraper/download', async (req, res) => {
    try {
        const { url, type } = req.body;
        
        if (!url || !type) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: url, type'
            });
        }

        const filePath = await multimodalScraper.downloadMedia(url, type);
        
        res.json({
            success: true,
            filePath
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Personalization endpoints
router.get('/personalization/context/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const context = await personalizationEngine.getPersonalizedContext(userId);
        
        res.json({
            success: true,
            context
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.post('/personalization/personalize', async (req, res) => {
    try {
        const { userId, originalResponse, context } = req.body;
        
        if (!userId || !originalResponse) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: userId, originalResponse'
            });
        }

        const result = await personalizationEngine.personalizeResponse(
            userId, 
            originalResponse, 
            context
        );
        
        res.json({
            success: true,
            ...result
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.post('/personalization/update-progress', async (req, res) => {
    try {
        const { userId, topic, success, difficulty } = req.body;
        
        if (!userId || !topic || success === undefined) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: userId, topic, success'
            });
        }

        await personalizationEngine.updateLearningProgress(userId, topic, success, difficulty);
        
        res.json({
            success: true,
            message: 'Learning progress updated'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Logging endpoints
router.post('/logging/activity', async (req, res) => {
    try {
        const { userId, action, details, sessionId } = req.body;
        
        if (!userId || !action) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: userId, action'
            });
        }

        await loggingService.logUserActivity(userId, action, details, sessionId);
        
        res.json({
            success: true,
            message: 'Activity logged'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.get('/logging/summary/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { timeRange = '7d' } = req.query;
        
        const summary = await loggingService.getUserActivitySummary(userId, timeRange);
        
        res.json({
            success: true,
            summary
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// LLM Training endpoints
router.get('/training/subjects', async (req, res) => {
    try {
        const subjects = llmTrainer.getAvailableSubjects();
        
        res.json({
            success: true,
            subjects
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.post('/training/start', async (req, res) => {
    try {
        const { subject, options } = req.body;
        
        if (!subject) {
            return res.status(400).json({
                success: false,
                error: 'Missing required field: subject'
            });
        }

        const result = await llmTrainer.startTraining(subject, options);
        
        res.json({
            success: true,
            ...result
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.get('/training/status/:jobId', async (req, res) => {
    try {
        const { jobId } = req.params;
        const status = llmTrainer.getTrainingStatus(jobId);
        
        if (!status) {
            return res.status(404).json({
                success: false,
                error: 'Training job not found'
            });
        }

        res.json({
            success: true,
            status
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.get('/training/models/:subject', async (req, res) => {
    try {
        const { subject } = req.params;
        const models = await llmTrainer.getTrainedModels(subject);
        
        res.json({
            success: true,
            models
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.get('/training/statistics', async (req, res) => {
    try {
        const statistics = await llmTrainer.getTrainingStatistics();
        
        res.json({
            success: true,
            statistics
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.delete('/training/job/:jobId', async (req, res) => {
    try {
        const { jobId } = req.params;
        const deleted = llmTrainer.deleteTrainingJob(jobId);
        
        if (!deleted) {
            return res.status(404).json({
                success: false,
                error: 'Training job not found'
            });
        }

        res.json({
            success: true,
            message: 'Training job deleted'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Enhanced Gemini Service endpoints
router.post('/enhanced-gemini/chat', async (req, res) => {
    try {
        const { message, userId, options } = req.body;
        
        if (!message || !userId) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: message, userId'
            });
        }

        const result = await enhancedGeminiService.chat(message, userId, options);
        
        res.json({
            success: true,
            ...result
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.post('/enhanced-gemini/explain', async (req, res) => {
    try {
        const { topic, userId, options } = req.body;
        
        if (!topic || !userId) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: topic, userId'
            });
        }

        const result = await enhancedGeminiService.explain(topic, userId, options);
        
        res.json({
            success: true,
            ...result
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.get('/enhanced-gemini/performance/:userId?', async (req, res) => {
    try {
        const { userId } = req.params;
        const stats = enhancedGeminiService.getPerformanceStats(userId);
        
        res.json({
            success: true,
            stats
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.get('/enhanced-gemini/cache/stats', async (req, res) => {
    try {
        const stats = enhancedGeminiService.getCacheStats();
        
        res.json({
            success: true,
            stats
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.post('/enhanced-gemini/cache/clear', async (req, res) => {
    try {
        enhancedGeminiService.clearCache();
        
        res.json({
            success: true,
            message: 'Cache cleared successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// MCP Protocol endpoints
router.post('/mcp/session', async (req, res) => {
    try {
        const { userId, sessionConfig } = req.body;
        
        if (!userId) {
            return res.status(400).json({
                success: false,
                error: 'Missing required field: userId'
            });
        }

        const sessionId = await mcpProtocol.createSession(userId, sessionConfig);
        
        res.json({
            success: true,
            sessionId
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.post('/mcp/session/:sessionId/message', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { message, options } = req.body;
        
        if (!message) {
            return res.status(400).json({
                success: false,
                error: 'Missing required field: message'
            });
        }

        const result = await mcpProtocol.processMessage(sessionId, message, options);
        
        res.json({
            success: true,
            ...result
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.post('/mcp/session/:sessionId/agent', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { agentId, agentConfig } = req.body;
        
        if (!agentId) {
            return res.status(400).json({
                success: false,
                error: 'Missing required field: agentId'
            });
        }

        const agentInstanceId = await mcpProtocol.spawnAgent(sessionId, agentId, agentConfig);
        
        res.json({
            success: true,
            agentInstanceId
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.get('/mcp/session/:sessionId/info', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const info = mcpProtocol.getSessionInfo(sessionId);
        
        if (!info) {
            return res.status(404).json({
                success: false,
                error: 'Session not found'
            });
        }

        res.json({
            success: true,
            info
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.delete('/mcp/session/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        await mcpProtocol.closeSession(sessionId);
        
        res.json({
            success: true,
            message: 'Session closed successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.get('/mcp/stats', async (req, res) => {
    try {
        const stats = mcpProtocol.getSystemStats();
        
        res.json({
            success: true,
            stats
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;