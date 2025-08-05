const ContentGeneration = require('../models/ContentGeneration');
const multiLLMRouter = require('./multiLLMRouter');
const multimodalScraper = require('./multimodalScraper');
const loggingService = require('./loggingService');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs').promises;
const path = require('path');
const winston = require('winston');

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ filename: 'logs/content-generation.log' }),
        new winston.transports.Console()
    ]
});

class AdvancedContentGenerator {
    constructor() {
        this.generationQueue = new Map();
        this.templates = this.initializeTemplates();
        this.outputDirectory = path.join(__dirname, '../generated_content');
        this.ensureOutputDirectory();
    }

    async ensureOutputDirectory() {
        try {
            await fs.access(this.outputDirectory);
        } catch (error) {
            await fs.mkdir(this.outputDirectory, { recursive: true });
        }
    }

    initializeTemplates() {
        return {
            report: {
                structure: [
                    'Executive Summary',
                    'Introduction',
                    'Literature Review',
                    'Methodology',
                    'Analysis',
                    'Results',
                    'Discussion',
                    'Conclusion',
                    'References'
                ],
                minSections: 5,
                targetLength: 5000
            },
            presentation: {
                structure: [
                    'Title Slide',
                    'Agenda',
                    'Introduction',
                    'Main Content',
                    'Key Points',
                    'Conclusion',
                    'Q&A'
                ],
                slidesPerSection: 3,
                maxSlides: 25
            },
            podcast: {
                structure: [
                    'Introduction',
                    'Topic Overview',
                    'Deep Dive',
                    'Expert Insights',
                    'Practical Applications',
                    'Conclusion'
                ],
                targetDuration: 1800, // 30 minutes
                speakers: 2
            },
            summary: {
                structure: [
                    'Key Points',
                    'Main Concepts',
                    'Important Details',
                    'Takeaways'
                ],
                targetLength: 1000
            },
            mindmap: {
                structure: [
                    'Central Topic',
                    'Main Branches',
                    'Sub-branches',
                    'Details'
                ],
                maxDepth: 4,
                maxNodes: 50
            }
        };
    }

    // Main content generation method
    async generateContent(userId, contentType, topic, parameters = {}) {
        const requestId = uuidv4();
        const startTime = Date.now();

        try {
            // Create content generation record
            const contentGeneration = new ContentGeneration({
                userId,
                requestId,
                contentType,
                topic,
                parameters: {
                    ...this.getDefaultParameters(contentType),
                    ...parameters
                },
                status: 'pending',
                processingTime: { startTime: new Date() }
            });

            await contentGeneration.save();

            // Log the generation request
            await loggingService.logUserActivity(userId, 'content_generation_start', {
                requestId,
                contentType,
                topic,
                parameters
            });

            // Add to processing queue
            this.generationQueue.set(requestId, {
                userId,
                contentType,
                topic,
                parameters,
                startTime
            });

            // Start generation process
            this.processContentGeneration(requestId);

            return {
                requestId,
                status: 'pending',
                estimatedTime: this.estimateGenerationTime(contentType, parameters),
                message: `Started generating ${contentType} about "${topic}"`
            };

        } catch (error) {
            logger.error('Failed to start content generation:', error);
            throw error;
        }
    }

    // Process content generation
    async processContentGeneration(requestId) {
        try {
            const request = this.generationQueue.get(requestId);
            if (!request) return;

            const { userId, contentType, topic, parameters } = request;

            // Update status to processing
            await this.updateGenerationStatus(requestId, 'processing', 'Gathering information', 10);

            // Step 1: Gather information from multiple sources
            const sources = await this.gatherInformation(topic, parameters);
            
            await this.updateGenerationStatus(requestId, 'processing', 'Analyzing content', 30);

            // Step 2: Route to appropriate LLM
            const llmRouting = await multiLLMRouter.routeRequest(
                'content_generation',
                `Generate ${contentType} about ${topic}`,
                userId,
                { contentType, urgency: parameters.urgency || 'normal' }
            );

            await this.updateGenerationStatus(requestId, 'processing', 'Generating content', 50);

            // Step 3: Generate content based on type
            const generatedContent = await this.generateSpecificContent(
                contentType,
                topic,
                sources,
                parameters,
                llmRouting.model
            );

            await this.updateGenerationStatus(requestId, 'processing', 'Finalizing content', 80);

            // Step 4: Post-process and save content
            const finalContent = await this.postProcessContent(
                generatedContent,
                contentType,
                parameters
            );

            // Step 5: Save to database and files
            await this.saveGeneratedContent(requestId, finalContent, sources);

            await this.updateGenerationStatus(requestId, 'completed', 'Content generation complete', 100);

            // Log completion
            const duration = Date.now() - request.startTime;
            await loggingService.logUserActivity(userId, 'content_generation_complete', {
                requestId,
                contentType,
                duration,
                success: true
            });

            // Update LLM performance
            await multiLLMRouter.updateModelPerformance(llmRouting.model.name, {
                latency: duration,
                success: true,
                userRating: 5 // Default rating, would be updated by user feedback
            });

        } catch (error) {
            logger.error(`Content generation failed for ${requestId}:`, error);
            
            await this.updateGenerationStatus(requestId, 'failed', error.message, 0);
            
            // Log failure
            const request = this.generationQueue.get(requestId);
            if (request) {
                await loggingService.logUserActivity(request.userId, 'content_generation_failed', {
                    requestId,
                    error: error.message
                });
            }
        } finally {
            this.generationQueue.delete(requestId);
        }
    }

    // Gather information from multiple sources
    async gatherInformation(topic, parameters) {
        try {
            const sources = [];

            // Web search for current information
            if (parameters.includeWebSources !== false) {
                const webResults = await multimodalScraper.searchWeb(topic, {
                    maxResults: 10,
                    includeVideos: parameters.includeVideos || false,
                    includeImages: parameters.includeImages || false
                });
                sources.push(...webResults);
            }

            // Academic sources if requested
            if (parameters.includeAcademicSources) {
                const academicResults = await multimodalScraper.searchAcademic(topic, {
                    maxResults: 5
                });
                sources.push(...academicResults);
            }

            // Filter and rank sources by relevance
            const rankedSources = this.rankSourcesByRelevance(sources, topic);

            return rankedSources.slice(0, parameters.maxSources || 15);

        } catch (error) {
            logger.error('Failed to gather information:', error);
            return [];
        }
    }

    // Generate content based on specific type
    async generateSpecificContent(contentType, topic, sources, parameters, llmModel) {
        const template = this.templates[contentType];
        if (!template) {
            throw new Error(`Unknown content type: ${contentType}`);
        }

        switch (contentType) {
            case 'report':
                return await this.generateReport(topic, sources, parameters, template, llmModel);
            case 'presentation':
                return await this.generatePresentation(topic, sources, parameters, template, llmModel);
            case 'podcast':
                return await this.generatePodcast(topic, sources, parameters, template, llmModel);
            case 'summary':
                return await this.generateSummary(topic, sources, parameters, template, llmModel);
            case 'mindmap':
                return await this.generateMindMap(topic, sources, parameters, template, llmModel);
            default:
                throw new Error(`Unsupported content type: ${contentType}`);
        }
    }

    // Generate report
    async generateReport(topic, sources, parameters, template, llmModel) {
        const sections = {};
        
        for (const sectionName of template.structure) {
            const sectionPrompt = this.createSectionPrompt(
                sectionName,
                topic,
                sources,
                parameters,
                'report'
            );

            const sectionContent = await this.callLLM(llmModel, sectionPrompt, {
                maxTokens: 800,
                temperature: 0.7
            });

            sections[sectionName] = sectionContent;
        }

        // Combine sections into full report
        const fullReport = this.combineReportSections(sections, topic, parameters);
        
        return {
            type: 'report',
            content: fullReport,
            sections,
            metadata: {
                wordCount: fullReport.split(' ').length,
                sections: Object.keys(sections),
                sources: sources.length
            }
        };
    }

    // Generate presentation
    async generatePresentation(topic, sources, parameters, template, llmModel) {
        const slides = [];
        
        for (const sectionName of template.structure) {
            const slidesForSection = await this.generateSlidesForSection(
                sectionName,
                topic,
                sources,
                parameters,
                llmModel
            );
            slides.push(...slidesForSection);
        }

        // Generate speaker notes
        const speakerNotes = await this.generateSpeakerNotes(slides, llmModel);

        return {
            type: 'presentation',
            slides,
            speakerNotes,
            metadata: {
                slideCount: slides.length,
                estimatedDuration: slides.length * 2, // 2 minutes per slide
                sections: template.structure.length
            }
        };
    }

    // Generate podcast script
    async generatePodcast(topic, sources, parameters, template, llmModel) {
        const speakers = parameters.speakers || template.speakers;
        const segments = [];

        for (const sectionName of template.structure) {
            const segmentScript = await this.generatePodcastSegment(
                sectionName,
                topic,
                sources,
                speakers,
                llmModel
            );
            segments.push(segmentScript);
        }

        // Generate audio cues and timing
        const audioScript = this.createAudioScript(segments, speakers);

        return {
            type: 'podcast',
            script: audioScript,
            segments,
            metadata: {
                estimatedDuration: this.estimatePodcastDuration(audioScript),
                speakers,
                segmentCount: segments.length
            }
        };
    }

    // Generate summary
    async generateSummary(topic, sources, parameters, template, llmModel) {
        const summaryPrompt = `Create a comprehensive summary about "${topic}" based on the following sources:

${sources.map(source => `- ${source.title}: ${source.content.substring(0, 200)}...`).join('\n')}

Requirements:
- Length: ${parameters.length || 'medium'}
- Style: ${parameters.style || 'educational'}
- Target audience: ${parameters.targetAudience || 'intermediate'}
- Include key points, main concepts, and important takeaways
- Use clear, engaging language

Summary:`;

        const summaryContent = await this.callLLM(llmModel, summaryPrompt, {
            maxTokens: 1500,
            temperature: 0.6
        });

        return {
            type: 'summary',
            content: summaryContent,
            metadata: {
                wordCount: summaryContent.split(' ').length,
                sources: sources.length
            }
        };
    }

    // Generate mind map
    async generateMindMap(topic, sources, parameters, template, llmModel) {
        const mindMapPrompt = `Create a detailed mind map structure for "${topic}" based on the following information:

${sources.map(source => `- ${source.content.substring(0, 150)}...`).join('\n')}

Create a hierarchical structure with:
- Central topic: ${topic}
- Main branches (3-6 key areas)
- Sub-branches for each main area
- Specific details and examples

Format as JSON with the following structure:
{
  "central": "${topic}",
  "branches": [
    {
      "name": "Branch Name",
      "subbranches": [
        {
          "name": "Sub-branch Name",
          "details": ["detail1", "detail2"]
        }
      ]
    }
  ]
}`;

        const mindMapJSON = await this.callLLM(llmModel, mindMapPrompt, {
            maxTokens: 2000,
            temperature: 0.5
        });

        try {
            const mindMapData = JSON.parse(mindMapJSON);
            return {
                type: 'mindmap',
                structure: mindMapData,
                metadata: {
                    branchCount: mindMapData.branches?.length || 0,
                    totalNodes: this.countMindMapNodes(mindMapData)
                }
            };
        } catch (error) {
            logger.error('Failed to parse mind map JSON:', error);
            return {
                type: 'mindmap',
                structure: { central: topic, branches: [] },
                error: 'Failed to generate structured mind map'
            };
        }
    }

    // Helper methods
    createSectionPrompt(sectionName, topic, sources, parameters, contentType) {
        const sourceText = sources.map(s => `${s.title}: ${s.content.substring(0, 300)}`).join('\n\n');
        
        return `Write the "${sectionName}" section for a ${contentType} about "${topic}".

Available sources:
${sourceText}

Requirements:
- Style: ${parameters.style || 'educational'}
- Target audience: ${parameters.targetAudience || 'intermediate'}
- Length: ${parameters.length || 'medium'}
- Include references where appropriate
- Use clear, engaging language

${sectionName} section:`;
    }

    async generateSlidesForSection(sectionName, topic, sources, parameters, llmModel) {
        const slidePrompt = `Create presentation slides for the "${sectionName}" section about "${topic}".

Generate 2-3 slides with:
- Slide title
- Key bullet points (3-5 per slide)
- Speaker notes
- Visual suggestions

Format as JSON array:
[
  {
    "title": "Slide Title",
    "bullets": ["Point 1", "Point 2", "Point 3"],
    "notes": "Speaker notes for this slide",
    "visual": "Suggestion for visual element"
  }
]`;

        const slidesJSON = await this.callLLM(llmModel, slidePrompt, {
            maxTokens: 1000,
            temperature: 0.6
        });

        try {
            return JSON.parse(slidesJSON);
        } catch (error) {
            logger.error('Failed to parse slides JSON:', error);
            return [{
                title: sectionName,
                bullets: [`Content for ${sectionName}`],
                notes: `Discuss ${sectionName} in detail`,
                visual: 'Relevant diagram or image'
            }];
        }
    }

    async generatePodcastSegment(sectionName, topic, sources, speakers, llmModel) {
        const segmentPrompt = `Create a podcast script segment for "${sectionName}" about "${topic}".

Speakers: ${speakers} people having a natural conversation
Style: Educational but engaging, like a friendly discussion

Format:
Speaker 1: [dialogue]
Speaker 2: [dialogue]
[Continue natural back-and-forth]

Include:
- Natural conversation flow
- Key information from sources
- Engaging questions and responses
- Smooth transitions

Segment script:`;

        const segmentScript = await this.callLLM(llmModel, segmentPrompt, {
            maxTokens: 1200,
            temperature: 0.8
        });

        return {
            section: sectionName,
            script: segmentScript,
            estimatedDuration: this.estimateSegmentDuration(segmentScript)
        };
    }

    async callLLM(model, prompt, options = {}) {
        // This would integrate with the actual LLM APIs
        // For now, returning a placeholder
        return `Generated content for: ${prompt.substring(0, 100)}...`;
    }

    // Utility methods
    rankSourcesByRelevance(sources, topic) {
        return sources.map(source => ({
            ...source,
            relevanceScore: this.calculateRelevanceScore(source, topic)
        })).sort((a, b) => b.relevanceScore - a.relevanceScore);
    }

    calculateRelevanceScore(source, topic) {
        const topicWords = topic.toLowerCase().split(' ');
        const sourceText = (source.title + ' ' + source.content).toLowerCase();
        
        let score = 0;
        topicWords.forEach(word => {
            const occurrences = (sourceText.match(new RegExp(word, 'g')) || []).length;
            score += occurrences;
        });

        return score;
    }

    combineReportSections(sections, topic, parameters) {
        let report = `# ${topic}\n\n`;
        
        for (const [sectionName, content] of Object.entries(sections)) {
            report += `## ${sectionName}\n\n${content}\n\n`;
        }

        return report;
    }

    createAudioScript(segments, speakers) {
        let audioScript = '';
        
        segments.forEach((segment, index) => {
            audioScript += `\n[SEGMENT ${index + 1}: ${segment.section}]\n`;
            audioScript += segment.script;
            audioScript += '\n[END SEGMENT]\n';
        });

        return audioScript;
    }

    estimatePodcastDuration(script) {
        // Rough estimation: 150 words per minute
        const wordCount = script.split(' ').length;
        return Math.ceil(wordCount / 150) * 60; // seconds
    }

    estimateSegmentDuration(script) {
        const wordCount = script.split(' ').length;
        return Math.ceil(wordCount / 150) * 60; // seconds
    }

    countMindMapNodes(mindMapData) {
        let count = 1; // Central node
        if (mindMapData.branches) {
            count += mindMapData.branches.length;
            mindMapData.branches.forEach(branch => {
                if (branch.subbranches) {
                    count += branch.subbranches.length;
                }
            });
        }
        return count;
    }

    async postProcessContent(content, contentType, parameters) {
        // Add formatting, citations, etc.
        let processedContent = content;

        if (parameters.includeReferences && content.metadata?.sources > 0) {
            processedContent.references = await this.generateReferences(content);
        }

        if (parameters.includeImages && contentType === 'presentation') {
            processedContent.imageRequests = await this.generateImageRequests(content);
        }

        return processedContent;
    }

    async generateReferences(content) {
        // Generate proper citations
        return ['Reference 1', 'Reference 2']; // Placeholder
    }

    async generateImageRequests(content) {
        // Generate image search queries for presentation slides
        return ['Image request 1', 'Image request 2']; // Placeholder
    }

    async saveGeneratedContent(requestId, content, sources) {
        try {
            // Update database record
            await ContentGeneration.findOneAndUpdate(
                { requestId },
                {
                    generatedContent: {
                        text: typeof content.content === 'string' ? content.content : JSON.stringify(content),
                        metadata: content.metadata
                    },
                    sources: sources.map(source => ({
                        type: 'web',
                        url: source.url,
                        title: source.title,
                        content: source.content.substring(0, 1000),
                        relevanceScore: source.relevanceScore,
                        extractedAt: new Date()
                    })),
                    processingTime: { endTime: new Date() }
                }
            );

            // Save to file system
            const fileName = `${requestId}_${content.type}.json`;
            const filePath = path.join(this.outputDirectory, fileName);
            await fs.writeFile(filePath, JSON.stringify(content, null, 2));

            logger.info(`Saved generated content to ${filePath}`);
        } catch (error) {
            logger.error('Failed to save generated content:', error);
        }
    }

    async updateGenerationStatus(requestId, status, currentStep, percentage) {
        try {
            await ContentGeneration.findOneAndUpdate(
                { requestId },
                {
                    status,
                    'progress.currentStep': currentStep,
                    'progress.percentage': percentage
                }
            );
        } catch (error) {
            logger.error('Failed to update generation status:', error);
        }
    }

    getDefaultParameters(contentType) {
        const defaults = {
            length: 'medium',
            style: 'educational',
            targetAudience: 'intermediate',
            includeReferences: true,
            includeImages: false,
            language: 'en',
            maxSources: 10
        };

        switch (contentType) {
            case 'presentation':
                return { ...defaults, includeImages: true, maxSlides: 20 };
            case 'podcast':
                return { ...defaults, speakers: 2, targetDuration: 1800 };
            case 'report':
                return { ...defaults, includeReferences: true, targetLength: 5000 };
            default:
                return defaults;
        }
    }

    estimateGenerationTime(contentType, parameters) {
        const baseTime = {
            report: 300, // 5 minutes
            presentation: 240, // 4 minutes
            podcast: 180, // 3 minutes
            summary: 60, // 1 minute
            mindmap: 90 // 1.5 minutes
        };

        let time = baseTime[contentType] || 120;
        
        // Adjust based on parameters
        if (parameters.length === 'long' || parameters.length === 'comprehensive') {
            time *= 1.5;
        }
        
        if (parameters.includeWebSources !== false) {
            time += 60; // Additional time for web scraping
        }

        return time;
    }

    // Get generation status
    async getGenerationStatus(requestId) {
        try {
            const generation = await ContentGeneration.findOne({ requestId });
            return generation ? {
                status: generation.status,
                progress: generation.progress,
                contentType: generation.contentType,
                topic: generation.topic,
                createdAt: generation.createdAt
            } : null;
        } catch (error) {
            logger.error('Failed to get generation status:', error);
            return null;
        }
    }

    // Get generated content
    async getGeneratedContent(requestId) {
        try {
            const generation = await ContentGeneration.findOne({ requestId });
            if (!generation || generation.status !== 'completed') {
                return null;
            }

            return {
                content: generation.generatedContent,
                sources: generation.sources,
                metadata: generation.generatedContent.metadata,
                qualityMetrics: generation.qualityMetrics
            };
        } catch (error) {
            logger.error('Failed to get generated content:', error);
            return null;
        }
    }
}

module.exports = new AdvancedContentGenerator();