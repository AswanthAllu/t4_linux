const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');
const fs = require('fs').promises;
const path = require('path');
const winston = require('winston');
const sharp = require('sharp');

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ filename: 'logs/multimodal-scraper.log' }),
        new winston.transports.Console()
    ]
});

class MultimodalScraper {
    constructor() {
        this.cache = new Map();
        this.rateLimiter = new Map();
        this.downloadDirectory = path.join(__dirname, '../downloads');
        this.supportedImageFormats = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'];
        this.supportedVideoFormats = ['.mp4', '.webm', '.ogg', '.avi'];
        this.supportedAudioFormats = ['.mp3', '.wav', '.ogg', '.m4a'];
        this.ensureDownloadDirectory();
    }

    async ensureDownloadDirectory() {
        try {
            await fs.access(this.downloadDirectory);
        } catch (error) {
            await fs.mkdir(this.downloadDirectory, { recursive: true });
        }
    }

    // Main search method for web content
    async searchWeb(query, options = {}) {
        try {
            const {
                maxResults = 10,
                includeImages = false,
                includeVideos = false,
                includeAudio = false,
                language = 'en',
                region = 'us'
            } = options;

            const results = [];

            // Search for text content
            const textResults = await this.searchTextContent(query, {
                maxResults: Math.ceil(maxResults * 0.6),
                language,
                region
            });
            results.push(...textResults);

            // Search for images if requested
            if (includeImages) {
                const imageResults = await this.searchImages(query, {
                    maxResults: Math.ceil(maxResults * 0.2),
                    language,
                    region
                });
                results.push(...imageResults);
            }

            // Search for videos if requested
            if (includeVideos) {
                const videoResults = await this.searchVideos(query, {
                    maxResults: Math.ceil(maxResults * 0.15),
                    language,
                    region
                });
                results.push(...videoResults);
            }

            // Search for audio if requested
            if (includeAudio) {
                const audioResults = await this.searchAudio(query, {
                    maxResults: Math.ceil(maxResults * 0.05),
                    language,
                    region
                });
                results.push(...audioResults);
            }

            return results.slice(0, maxResults);

        } catch (error) {
            logger.error('Web search failed:', error);
            return [];
        }
    }

    // Search for text content
    async searchTextContent(query, options = {}) {
        try {
            // Use DuckDuckGo for text search (respects privacy)
            const searchUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
            
            const response = await this.makeRequest(searchUrl);
            const data = response.data;

            const results = [];

            // Process instant answer
            if (data.Answer) {
                results.push({
                    type: 'text',
                    title: 'Instant Answer',
                    content: data.Answer,
                    url: data.AnswerURL || '',
                    source: 'DuckDuckGo',
                    relevanceScore: 0.9
                });
            }

            // Process abstract
            if (data.Abstract) {
                results.push({
                    type: 'text',
                    title: data.Heading || 'Abstract',
                    content: data.Abstract,
                    url: data.AbstractURL || '',
                    source: data.AbstractSource || 'Wikipedia',
                    relevanceScore: 0.8
                });
            }

            // Process related topics
            if (data.RelatedTopics) {
                for (const topic of data.RelatedTopics.slice(0, 5)) {
                    if (topic.Text) {
                        results.push({
                            type: 'text',
                            title: topic.Result ? this.extractTitle(topic.Result) : 'Related Topic',
                            content: topic.Text,
                            url: topic.FirstURL || '',
                            source: 'DuckDuckGo',
                            relevanceScore: 0.6
                        });
                    }
                }
            }

            // Scrape additional web pages for more content
            const additionalResults = await this.scrapeWebPages(query, options.maxResults - results.length);
            results.push(...additionalResults);

            return results.slice(0, options.maxResults);

        } catch (error) {
            logger.error('Text content search failed:', error);
            return [];
        }
    }

    // Scrape web pages for additional content
    async scrapeWebPages(query, maxResults = 5) {
        try {
            const searchEngines = [
                `https://www.google.com/search?q=${encodeURIComponent(query)}`,
                `https://www.bing.com/search?q=${encodeURIComponent(query)}`
            ];

            const results = [];
            
            for (const searchUrl of searchEngines) {
                if (results.length >= maxResults) break;

                try {
                    const response = await this.makeRequest(searchUrl, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                        }
                    });

                    const $ = cheerio.load(response.data);
                    const links = [];

                    // Extract search result links (Google)
                    $('a[href*="/url?q="]').each((i, elem) => {
                        const href = $(elem).attr('href');
                        if (href) {
                            const url = new URL(href, searchUrl).searchParams.get('q');
                            if (url && !url.includes('google.com') && !url.includes('youtube.com')) {
                                links.push(url);
                            }
                        }
                    });

                    // Extract search result links (Bing)
                    $('a[href^="http"]').each((i, elem) => {
                        const href = $(elem).attr('href');
                        if (href && !href.includes('bing.com') && !href.includes('microsoft.com')) {
                            links.push(href);
                        }
                    });

                    // Scrape content from found links
                    for (const link of links.slice(0, 3)) {
                        if (results.length >= maxResults) break;

                        const pageContent = await this.scrapePageContent(link);
                        if (pageContent) {
                            results.push(pageContent);
                        }
                    }

                } catch (error) {
                    logger.warn(`Failed to search on ${searchUrl}:`, error.message);
                }
            }

            return results;

        } catch (error) {
            logger.error('Web page scraping failed:', error);
            return [];
        }
    }

    // Scrape content from a specific page
    async scrapePageContent(url) {
        try {
            if (this.cache.has(url)) {
                return this.cache.get(url);
            }

            const response = await this.makeRequest(url, {
                timeout: 10000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            const $ = cheerio.load(response.data);
            
            // Remove unwanted elements
            $('script, style, nav, footer, aside, .advertisement, .ads').remove();

            // Extract title
            const title = $('title').text().trim() || 
                         $('h1').first().text().trim() || 
                         'Untitled';

            // Extract main content
            let content = '';
            
            // Try to find main content area
            const contentSelectors = [
                'main',
                'article',
                '.content',
                '.main-content',
                '#content',
                '.post-content',
                '.entry-content'
            ];

            for (const selector of contentSelectors) {
                const element = $(selector);
                if (element.length) {
                    content = element.text().trim();
                    break;
                }
            }

            // Fallback to body content
            if (!content) {
                content = $('body').text().trim();
            }

            // Clean up content
            content = content.replace(/\s+/g, ' ').substring(0, 2000);

            if (content.length < 100) {
                return null; // Skip pages with too little content
            }

            const result = {
                type: 'text',
                title: title.substring(0, 200),
                content,
                url,
                source: new URL(url).hostname,
                scrapedAt: new Date(),
                relevanceScore: 0.5
            };

            // Cache the result
            this.cache.set(url, result);

            return result;

        } catch (error) {
            logger.warn(`Failed to scrape ${url}:`, error.message);
            return null;
        }
    }

    // Search for images
    async searchImages(query, options = {}) {
        try {
            const results = [];

            // Use Unsplash API for high-quality images
            const unsplashResults = await this.searchUnsplash(query, options.maxResults);
            results.push(...unsplashResults);

            // Search for images on web pages
            const webImageResults = await this.searchWebImages(query, options.maxResults - results.length);
            results.push(...webImageResults);

            return results.slice(0, options.maxResults);

        } catch (error) {
            logger.error('Image search failed:', error);
            return [];
        }
    }

    // Search Unsplash for images
    async searchUnsplash(query, maxResults = 5) {
        try {
            const accessKey = process.env.UNSPLASH_ACCESS_KEY;
            if (!accessKey) {
                logger.warn('Unsplash access key not configured');
                return [];
            }

            const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${maxResults}`;
            const response = await this.makeRequest(url, {
                headers: {
                    'Authorization': `Client-ID ${accessKey}`
                }
            });

            return response.data.results.map(photo => ({
                type: 'image',
                title: photo.alt_description || photo.description || 'Untitled Image',
                content: photo.description || '',
                url: photo.urls.regular,
                thumbnailUrl: photo.urls.thumb,
                source: 'Unsplash',
                metadata: {
                    width: photo.width,
                    height: photo.height,
                    photographer: photo.user.name,
                    downloadUrl: photo.links.download
                },
                relevanceScore: 0.7
            }));

        } catch (error) {
            logger.warn('Unsplash search failed:', error.message);
            return [];
        }
    }

    // Search for images on web pages
    async searchWebImages(query, maxResults = 3) {
        // This would implement image search across web pages
        // For now, returning empty array as it requires more complex implementation
        return [];
    }

    // Search for videos
    async searchVideos(query, options = {}) {
        try {
            const results = [];

            // Search YouTube (would need YouTube API key)
            const youtubeResults = await this.searchYouTube(query, options.maxResults);
            results.push(...youtubeResults);

            return results.slice(0, options.maxResults);

        } catch (error) {
            logger.error('Video search failed:', error);
            return [];
        }
    }

    // Search YouTube for videos
    async searchYouTube(query, maxResults = 3) {
        try {
            const apiKey = process.env.YOUTUBE_API_KEY;
            if (!apiKey) {
                logger.warn('YouTube API key not configured');
                return [];
            }

            const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&type=video&maxResults=${maxResults}&key=${apiKey}`;
            const response = await this.makeRequest(url);

            return response.data.items.map(video => ({
                type: 'video',
                title: video.snippet.title,
                content: video.snippet.description,
                url: `https://www.youtube.com/watch?v=${video.id.videoId}`,
                thumbnailUrl: video.snippet.thumbnails.medium.url,
                source: 'YouTube',
                metadata: {
                    channelTitle: video.snippet.channelTitle,
                    publishedAt: video.snippet.publishedAt,
                    videoId: video.id.videoId
                },
                relevanceScore: 0.6
            }));

        } catch (error) {
            logger.warn('YouTube search failed:', error.message);
            return [];
        }
    }

    // Search for audio content
    async searchAudio(query, options = {}) {
        try {
            // This would implement audio search (podcasts, music, etc.)
            // For now, returning empty array as it requires specialized APIs
            return [];

        } catch (error) {
            logger.error('Audio search failed:', error);
            return [];
        }
    }

    // Search academic sources
    async searchAcademic(query, options = {}) {
        try {
            const results = [];

            // Search arXiv for academic papers
            const arxivResults = await this.searchArxiv(query, options.maxResults);
            results.push(...arxivResults);

            return results.slice(0, options.maxResults);

        } catch (error) {
            logger.error('Academic search failed:', error);
            return [];
        }
    }

    // Search arXiv for academic papers
    async searchArxiv(query, maxResults = 5) {
        try {
            const url = `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=${maxResults}`;
            const response = await this.makeRequest(url);

            const $ = cheerio.load(response.data, { xmlMode: true });
            const results = [];

            $('entry').each((i, entry) => {
                const $entry = $(entry);
                results.push({
                    type: 'academic',
                    title: $entry.find('title').text().trim(),
                    content: $entry.find('summary').text().trim(),
                    url: $entry.find('id').text().trim(),
                    source: 'arXiv',
                    metadata: {
                        authors: $entry.find('author name').map((i, el) => $(el).text()).get(),
                        published: $entry.find('published').text().trim(),
                        updated: $entry.find('updated').text().trim(),
                        categories: $entry.find('category').map((i, el) => $(el).attr('term')).get()
                    },
                    relevanceScore: 0.8
                });
            });

            return results;

        } catch (error) {
            logger.warn('arXiv search failed:', error.message);
            return [];
        }
    }

    // Download and process media files
    async downloadMedia(url, type) {
        try {
            const fileName = this.generateFileName(url, type);
            const filePath = path.join(this.downloadDirectory, fileName);

            // Check if file already exists
            try {
                await fs.access(filePath);
                return filePath; // File already exists
            } catch (error) {
                // File doesn't exist, proceed with download
            }

            const response = await this.makeRequest(url, {
                responseType: 'stream',
                timeout: 30000
            });

            const writer = require('fs').createWriteStream(filePath);
            response.data.pipe(writer);

            return new Promise((resolve, reject) => {
                writer.on('finish', async () => {
                    try {
                        // Process the downloaded file based on type
                        const processedPath = await this.processDownloadedFile(filePath, type);
                        resolve(processedPath);
                    } catch (error) {
                        reject(error);
                    }
                });
                writer.on('error', reject);
            });

        } catch (error) {
            logger.error(`Failed to download media from ${url}:`, error);
            throw error;
        }
    }

    // Process downloaded files
    async processDownloadedFile(filePath, type) {
        try {
            switch (type) {
                case 'image':
                    return await this.processImage(filePath);
                case 'video':
                    return await this.processVideo(filePath);
                case 'audio':
                    return await this.processAudio(filePath);
                default:
                    return filePath;
            }
        } catch (error) {
            logger.error(`Failed to process ${type} file:`, error);
            return filePath;
        }
    }

    // Process images
    async processImage(filePath) {
        try {
            const metadata = await sharp(filePath).metadata();
            
            // Create thumbnail if image is large
            if (metadata.width > 800 || metadata.height > 600) {
                const thumbnailPath = filePath.replace(/(\.[^.]+)$/, '_thumb$1');
                await sharp(filePath)
                    .resize(400, 300, { fit: 'inside', withoutEnlargement: true })
                    .jpeg({ quality: 80 })
                    .toFile(thumbnailPath);
                
                return {
                    original: filePath,
                    thumbnail: thumbnailPath,
                    metadata
                };
            }

            return {
                original: filePath,
                metadata
            };

        } catch (error) {
            logger.error('Image processing failed:', error);
            return filePath;
        }
    }

    // Process videos (placeholder - would need ffmpeg)
    async processVideo(filePath) {
        // This would extract video metadata, create thumbnails, etc.
        // Requires ffmpeg integration
        return filePath;
    }

    // Process audio (placeholder - would need audio processing libraries)
    async processAudio(filePath) {
        // This would extract audio metadata, create waveforms, etc.
        return filePath;
    }

    // Utility methods
    async makeRequest(url, options = {}) {
        // Rate limiting
        const domain = new URL(url).hostname;
        const now = Date.now();
        const lastRequest = this.rateLimiter.get(domain) || 0;
        
        if (now - lastRequest < 1000) { // 1 second rate limit per domain
            await new Promise(resolve => setTimeout(resolve, 1000 - (now - lastRequest)));
        }
        
        this.rateLimiter.set(domain, Date.now());

        const defaultOptions = {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; EducationalBot/1.0)'
            }
        };

        return await axios({ url, ...defaultOptions, ...options });
    }

    generateFileName(url, type) {
        const urlObj = new URL(url);
        const timestamp = Date.now();
        const extension = path.extname(urlObj.pathname) || this.getDefaultExtension(type);
        
        return `${type}_${timestamp}${extension}`;
    }

    getDefaultExtension(type) {
        const extensions = {
            image: '.jpg',
            video: '.mp4',
            audio: '.mp3',
            text: '.txt'
        };
        return extensions[type] || '.bin';
    }

    extractTitle(htmlString) {
        const $ = cheerio.load(htmlString);
        return $.text().split(' ').slice(0, 10).join(' ');
    }

    // Clean up old downloads
    async cleanupOldDownloads(maxAge = 7 * 24 * 60 * 60 * 1000) { // 7 days
        try {
            const files = await fs.readdir(this.downloadDirectory);
            const now = Date.now();

            for (const file of files) {
                const filePath = path.join(this.downloadDirectory, file);
                const stats = await fs.stat(filePath);
                
                if (now - stats.mtime.getTime() > maxAge) {
                    await fs.unlink(filePath);
                    logger.info(`Cleaned up old download: ${file}`);
                }
            }
        } catch (error) {
            logger.error('Failed to cleanup old downloads:', error);
        }
    }
}

module.exports = new MultimodalScraper();