const express = require('express');
const router = express.Router();
const studentFeatures = require('../services/studentFeatures');

// Study Plan endpoints
router.post('/study-plans', async (req, res) => {
    try {
        const { userId, ...planData } = req.body;
        
        if (!userId) {
            return res.status(400).json({
                success: false,
                error: 'Missing required field: userId'
            });
        }

        const result = await studentFeatures.createStudyPlan(userId, planData);
        
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

router.get('/study-plans/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const plans = await studentFeatures.getUserStudyPlans(userId);
        
        res.json({
            success: true,
            plans
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.get('/study-plans/:userId/:planId', async (req, res) => {
    try {
        const { userId, planId } = req.params;
        const plan = await studentFeatures.getStudyPlan(userId, planId);
        
        if (!plan) {
            return res.status(404).json({
                success: false,
                error: 'Study plan not found'
            });
        }

        res.json({
            success: true,
            plan
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.post('/study-plans/:userId/:planId/progress', async (req, res) => {
    try {
        const { userId, planId } = req.params;
        const sessionData = req.body;
        
        const result = await studentFeatures.updateStudyProgress(userId, planId, sessionData);
        
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

// Progress Dashboard endpoints
router.get('/dashboard/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const dashboard = await studentFeatures.getProgressDashboard(userId);
        
        if (!dashboard) {
            return res.status(404).json({
                success: false,
                error: 'User profile not found'
            });
        }

        res.json({
            success: true,
            dashboard
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.get('/progress/weekly/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const weeklyProgress = await studentFeatures.getWeeklyProgress(userId);
        
        res.json({
            success: true,
            weeklyProgress
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Study Group endpoints
router.post('/study-groups', async (req, res) => {
    try {
        const { creatorId, ...groupData } = req.body;
        
        if (!creatorId) {
            return res.status(400).json({
                success: false,
                error: 'Missing required field: creatorId'
            });
        }

        const result = await studentFeatures.createStudyGroup(creatorId, groupData);
        
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

router.get('/study-groups/public', async (req, res) => {
    try {
        const { subject } = req.query;
        const groups = await studentFeatures.getPublicStudyGroups(subject);
        
        res.json({
            success: true,
            groups
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.get('/study-groups/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const groups = await studentFeatures.getUserStudyGroups(userId);
        
        res.json({
            success: true,
            groups
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.post('/study-groups/:groupId/join', async (req, res) => {
    try {
        const { groupId } = req.params;
        const { userId, inviteCode } = req.body;
        
        if (!userId) {
            return res.status(400).json({
                success: false,
                error: 'Missing required field: userId'
            });
        }

        const result = await studentFeatures.joinStudyGroup(userId, groupId, inviteCode);
        
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Collaboration endpoints
router.post('/collaboration/start', async (req, res) => {
    try {
        const { userId, groupId, ...sessionData } = req.body;
        
        if (!userId || !groupId) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: userId, groupId'
            });
        }

        const result = await studentFeatures.startCollaborationSession(userId, groupId, sessionData);
        
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

// Achievement endpoints
router.get('/achievements/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const dashboard = await studentFeatures.getProgressDashboard(userId);
        
        if (!dashboard) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        res.json({
            success: true,
            achievements: dashboard.achievements
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;