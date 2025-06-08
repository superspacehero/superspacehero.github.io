import { readFileSync, existsSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'fs';
import { relative, basename, dirname, extname, join, resolve } from 'path';
import { parse } from 'marked';
import fm from 'front-matter';
import { JSDOM } from 'jsdom';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const template = readFileSync('template.html', 'utf8');
const config = JSON.parse(readFileSync('config.json', 'utf8'));

const args = process.argv.slice(2);

// Global asset cache to avoid redundant processing (e.g., video posters, images)
const assetCache = {};

class AssetData {
  constructor(data, fileType, encoding, varName) {
    this.data = data;
    this.fileType = fileType;
    this.encoding = encoding;
    this.varName = varName;
  }
  getMimeType() {
    switch (this.fileType) {
      case 'css': return 'text/css';
      case 'js': return 'application/javascript';
      case 'svg': return 'image/svg+xml';
      case 'json':
      case 'webmanifest': return 'application/json';
      case 'png': return 'image/png';
      case 'jpg':
      case 'jpeg': return 'image/jpeg';
      case 'webp': return 'image/webp';
      case 'gif': return 'image/gif';
      case 'ico': return 'image/x-icon';
      case 'webm': return 'video/webm';
      case 'mp4': return 'video/mp4';
      default: return 'application/octet-stream';
    }
  }
  getDataUrl() {
    if (this.encoding === 'base64') {
      return `data:${this.getMimeType()};${this.encoding},${this.data}`;
    } else if (this.encoding === 'url') {
      return this.data;
    } else {
      return `data:${this.getMimeType()};charset=utf-8,${encodeURIComponent(this.data)}`;
    }
  }
}

async function processVideo(outputDir, videoPath) {
  let videoFile = join(outputDir, videoPath);
  const VIDEO_FILENAME_REGEX = /(.*?)(?:@([\d]+))?(\.(webm|mp4))/i;
  let match = videoPath.match(VIDEO_FILENAME_REGEX);
  if (!match) {
    console.error(`[ERR] ${outputDir}: Invalid video file format: ${videoPath}`);
    return;
  }
  const base = match[1];
  const ext = match[3];

  // Check if ffmpeg is installed
  let ffmpegExists = false;
  try {
    await execFileAsync('ffmpeg', ['-version'], { timeout: 3000 });
    ffmpegExists = true;
  } catch (e) {
    console.error('[ERR] ${outputDir}: ffmpeg is not installed or not in PATH. Please install ffmpeg.');
    return;
  }

  // Validate video file path
  const videoDir = dirname(videoFile);
  if (!existsSync(videoDir)) {
    console.error(`[ERR] ${outputDir}: Video directory does not exist: ${videoDir}`);
    return;
  }

  // Search for the video file, looking for the path to start with the base and end with the extension
  const videoFiles = readdirSync(videoDir).filter(f => {
    return f.startsWith(basename(base)) && f.endsWith(ext);
  });

  if (videoFiles.length === 0) {
    console.error(`[ERR] ${outputDir}: No video files found matching: ${videoFile}`);
    return;
  }

  // Use the first matching video file
  videoFile = join(videoDir, videoFiles[0]);
  match = videoFile.match(VIDEO_FILENAME_REGEX);
  if (!match) {
    console.error(`[ERR] ${outputDir}: Invalid video file format after matching: ${videoFile}`);
    return;
  }
  const atTime = match[2] || '0';

  const posterPath = `${outputDir}/${base}.png`;

  // Use system ffmpeg to extract the frame at the specified time, with a timeout
  try {
    console.log(`[LOG] ${outputDir}: Extracting poster image from ${videoFile} at ${atTime} seconds to ${posterPath}`);
    await execFileAsync('ffmpeg', [
      '-y', // Overwrite output file if exists
      '-i', videoFile,
      '-ss', atTime,
      '-vframes', '1',
      posterPath
    ], { timeout: 8000 });
    console.log(`[LOG] ${outputDir}: Extracted poster image from ${videoFile} to ${posterPath}`);
  } catch (error) {
    if (error.killed || error.signal === 'SIGTERM') {
      console.error(`[ERR] ${outputDir}: ffmpeg timed out for ${videoFile}`);
    } else {
      console.error(`[ERR] ${outputDir}: Failed to extract poster image from ${videoFile}:`, error);
    }
    return;
  }

  // Return both the adjusted video path and the poster path
  videoFile = join(outputDir, basename(videoFile));
  let posterPathOut = join(outputDir, basename(posterPath));
  return { videoFile, posterPath: posterPathOut };
}

async function processMarkdown(filePath, outputPath, writeToFile = true) {
  let content = readFileSync(filePath, 'utf8');

  let parsed = fm(content);

  const outputDir = dirname(outputPath);

  const subtitle = (parsed.attributes.company && parsed.attributes.year) ? `${parsed.attributes.company}, ${parsed.attributes.year}` : (parsed.attributes.subtitle || config.siteSubtitle || '');
  const phoneURL = config.phone ? `tel:${config.phone.replace(/[^\d]/g, '')}` : '';

  // Process {{ABOUT}} placeholder before any other processing
  // Replace placeholders in the expanded {{ABOUT}} content before markdown processing
  parsed.body = parsed.body.replace(/\{\{ABOUT\}\}/g, `# Info\n\n## {{DOWNLOAD}}\n\n{{DESCRIPTION}}`);

  // Replace all content placeholders before markdown processing
  parsed.body = parsed.body.replace(/\{\{FIRST_NAME\}\}/g, config.firstName || 'First name not working in markdown');
  parsed.body = parsed.body.replace(/\{\{LAST_NAME\}\}/g, config.lastName || 'Last name not working in markdown');
  parsed.body = parsed.body.replace(/\{\{LEGAL_NAME\}\}/g, config.legalName || 'Legal name not working in markdown');

  parsed.body = parsed.body.replace(/\{\{URL\}\}/g, config.siteUrl || 'URL not working in markdown');
  parsed.body = parsed.body.replace(/\{\{EMAIL\}\}/g, config.email || 'Email not working in markdown');
  parsed.body = parsed.body.replace(/\{\{CITY\}\}/g, config.city || 'City not working in markdown');
  parsed.body = parsed.body.replace(/\{\{PHONE\}\}/g, config.phone || 'Phone not working in markdown');
  parsed.body = parsed.body.replace(/\{\{PHONE_URL\}\}/g, phoneURL);
  parsed.body = parsed.body.replace(/\{\{GITHUB\}\}/g, config.github || 'GitHub not working in markdown');
  parsed.body = parsed.body.replace(/\{\{LINKEDIN\}\}/g, config.linkedin || 'LinkedIn not working in markdown');
  parsed.body = parsed.body.replace(/\{\{SUBTITLE\}\}/g, subtitle);

  parsed.body = parsed.body.replace(/\{\{DOWNLOAD\}\}/g, parsed.attributes.download || 'Download not working in markdown');
  parsed.body = parsed.body.replace(/\{\{DESCRIPTION\}\}/g, parsed.attributes.description || config.siteDescription);
  parsed.body = parsed.body.replace(/\{\{PLATFORM\}\}/g, parsed.attributes.platform || 'Platforms not working in markdown');

  // Replace years placeholders with span elements for JavaScript to populate
  parsed.body = parsed.body.replace(/\{\{YEARS_WORKED\}\}/g, '<span class="dynamic-years" data-type="worked"></span>');
  parsed.body = parsed.body.replace(/\{\{GAME_DEV_YEARS\}\}/g, '<span class="dynamic-years" data-type="gamedev"></span>');

  // Process image markdown with async operations
  const imageRegex = /(!\[[^\]]*\]\([^\)]+\))/g;
  const matches = [...parsed.body.matchAll(imageRegex)];

  console.log(`[LOG] ${outputDir}: Found ${matches.length} image/video markdown matches in ${filePath}`);

  for (const match of matches) {
    const [fullMatch] = match;
    // Extract alt and src from the markdown
    const mdMatch = fullMatch.match(/!\[([^\]]*)\]\(([^\)]+)\)/);
    if (!mdMatch) continue;
    const alt = mdMatch[1];
    let src = mdMatch[2];
    let replacement;

    if (src.endsWith('.webm') || src.endsWith('.mp4')) {
      replacement = `<video loop muted autoplay class="pics" alt="${alt}">\n<source src="${src}" type="video/${src.split('.').pop()}" />\n</video>`;
    } else {
      replacement = `<img class="pics" src="${src}" alt="${alt}" />`;
    }

    parsed.body = parsed.body.replace(fullMatch, replacement);
  }
  console.log(`[LOG] ${outputDir}: Finished image/video markdown replacement for ${filePath}`);

  // Check for local template.html in the same directory
  const dir = dirname(filePath);
  const localTemplatePath = join(dir, 'template.html');
  let currentTemplate = template; // Default to global template

  if (existsSync(localTemplatePath)) {
    currentTemplate = readFileSync(localTemplatePath, 'utf8');
    console.log(`[LOG] Using local template: ${localTemplatePath}`);
  }

  // Create JSDOM instance to parse the template
  let htmlDom = new JSDOM(currentTemplate);
  let document = htmlDom.window.document;

  // If the template has a script with a "process-markdown" class, execute it in our context
  const templateMarkdownProcessing = document.querySelector('script.process-markdown');
  if (templateMarkdownProcessing && templateMarkdownProcessing.textContent) {
    // Run the script content in this context
    let content = parsed.body;

    eval(templateMarkdownProcessing.textContent);

    parsed.body = content;
  }

  // Use config for site title and append page title
  const pageTitle = parsed.attributes.title || config.siteTitle;
  const fullTitle = pageTitle.includes(config.siteTitle) ? pageTitle : `${config.siteTitle} - ${pageTitle}`;
  const fullURL = new URL(outputPath.replace(/\\/g, '/'), config.siteUrl).href;

  // Create the favicon links HTML
  const relFavicon = (file) => {
    let prefix = relative(outputDir, '.');

    if (prefix.length > 0 && !prefix.endsWith('/')) {
      prefix += '/';
    }

    return `${prefix}${file}`;
  };
  const faviconLinks = `
    <link rel="apple-touch-icon" sizes="180x180" href="${relFavicon('media/favicons/apple-touch-icon.png')}" />
    <link rel="icon" type="image/png" sizes="32x32" href="${relFavicon('media/favicons/favicon-32x32.png')}" />
    <link rel="icon" type="image/png" sizes="16x16" href="${relFavicon('media/favicons/favicon-16x16.png')}" />
    <link rel="manifest" href="${relFavicon('media/favicons/site.webmanifest')}" />`;

  let html = htmlDom.serialize();
  console.log(`[LOG] ${outputDir}: Template HTML serialized for ${filePath}`);

  // Replace all placeholders with global regex
  html = html.replace(/\{\{FULL_TITLE\}\}/g, fullTitle);
  html = html.replace(/\{\{TITLE\}\}/g, (outputDir === '.') ? config.siteTitle : parsed.attributes.title || config.siteTitle);
  html = html.replace(/\{\{SUBTITLE\}\}/g, parsed.attributes.subtitle || config.siteSubtitle);

  html = html.replace(/\{\{FIRST_NAME\}\}/g, config.firstName || 'First name not working in HTML');
  html = html.replace(/\{\{LAST_NAME\}\}/g, config.lastName || 'Last name not working in HTML');
  html = html.replace(/\{\{LEGAL_NAME\}\}/g, config.legalName || 'Legal name not working in HTML');

  html = html.replace(/\{\{EMAIL\}\}/g, config.email || 'Email not working in HTML');
  html = html.replace(/\{\{PHONE\}\}/g, config.phone || 'Phone not working in HTML');
  html = html.replace(/\{\{PHONE_URL\}\}/g, phoneURL);
  html = html.replace(/\{\{GITHUB\}\}/g, config.github || 'GitHub not working in HTML');
  html = html.replace(/\{\{BLUESKY\}\}/g, config.bluesky || 'Bluesky not working in HTML');
  html = html.replace(/\{\{LINKEDIN\}\}/g, config.linkedin || 'LinkedIn not working in HTML');
  html = html.replace(/\{\{DESCRIPTION\}\}/g, parsed.attributes.description || config.siteDescription);
  html = html.replace(/\{\{DOWNLOAD\}\}/g, parsed.attributes.download || 'Download not working in HTML');
  html = html.replace(/\{\{URL\}\}/g, fullURL);
  html = html.replace(/\{\{FAVICON_LINKS\}\}/g, faviconLinks);

  // Add relative path replacements
  html = html.replace(/\{\{BASE\}\}/g, `${relative(outputDir, '.') || '.'}/`);

  const videoSource = parsed.attributes.video_source || 'media/videos/Hero.webm';
  html = html.replace(/\{\{VIDEO_SOURCE\}\}/g, videoSource);

  // Handle buttons array
  const buttons = parsed.attributes.buttons || ['', '', '', ''];
  html = html.replace(/\{\{BUTTON_TOP_LEFT\}\}/g, buttons[0]);
  html = html.replace(/\{\{BUTTON_TOP_RIGHT\}\}/g, buttons[1]);
  html = html.replace(/\{\{BUTTON_BOTTOM_LEFT\}\}/g, buttons[2]);
  html = html.replace(/\{\{BUTTON_BOTTOM_RIGHT\}\}/g, buttons[3]);

  html = html.replace(/\{\{CONTENT\}\}/g, parse(parsed.body));
  console.log(`[LOG] ${outputDir}: Inserted parsed markdown content for ${filePath}`);

  // Replace single backtick inline code
  html = html.replace(/<code>(.+?)<\/code>/g, `<$1/>`);

  htmlDom = new JSDOM(html);
  document = htmlDom.window.document;

  console.log(`[LOG] ${outputDir}: Processing hyperlinks for ${filePath}`);
  document.body.querySelectorAll('a[href]').forEach(el => {
    let href = el.getAttribute('href');
    if (!href) {
      console.error(`Missing href attribute in HTML: ${el.outerHTML}`);
      return;
    }
    // Add target="_blank" to external hyperlinks
    if (href.startsWith('http')) {
      el.setAttribute('target', '_blank');
      console.log(`[LOG] ${outputDir}: Making external link open in new tab: ${href}`);
      return;
    }

    // Skip any other non-local links
    if (href.includes(':')) {
      console.log(`[LOG] ${outputDir}: Skipping non-local link: ${href}`);
      return;
    }

    const originalHref = href;

    // If a hyperlink points to a directory, append index.html
    if (statSync(join(outputDir, href)).isDirectory()) {
      if (!href.endsWith('/')) {
        href += '/';
      }

      href += 'index.html';
      console.log(`[LOG] ${outputDir}: Pointed hyperlink from ${originalHref} to ${href}`);
    }

    el.setAttribute('href', href);
  });

  // Collect all async operations for asset rewriting
  const assetRewritePromises = [];

  ['src', 'href', 'poster'].forEach(attr => {
    document.querySelectorAll(`[${attr}]`).forEach(el => {
      assetRewritePromises.push((async () => {
        let val = el.getAttribute(attr);
        let elDesc = `[${attr}]="${val}" in ${filePath}`;
        try {
          if (!val) {
            console.error(`[ERR] ${outputDir}: Missing ${attr} attribute in HTML: ${el.outerHTML}`);
            return;
          }

          // Skip external links
          if (val.includes(':')) {
            return;
          }

          // Process videos
          if (val.endsWith('.webm') || val.endsWith('.mp4')) {
            const videoData = await processVideo(outputDir, val);
            if (videoData) {
              // If we have a video poster, set it
              if (videoData.posterPath) {
                el.setAttribute('poster', videoData.posterPath);
              }
              // Set the video source to the processed path
              val = videoData.videoFile;
            } else {
              return;
            }
          } else {
            // Process other assets (images, etc.)
            const assetPath = join(outputDir, val);
            if (existsSync(assetPath)) {
              // Check cache first
              let cached = assetCache[val];
              if (cached) {
                val = cached;
              } else {
                // Cache the asset
                assetCache[val] = assetPath;
                val = assetPath;
              }
            } else {
              console.warn(`[WAR] ${outputDir}: Asset not found: ${assetPath}`);
            }
          }

          el.setAttribute(attr, val);
        } catch (err) {
          console.error(`[ERR] ${outputDir}: Exception in asset rewrite for ${elDesc}:`, err);
        }
      })());
    });
  });

  // Wait for all asset rewriting to complete
  await Promise.all(assetRewritePromises);
  console.log(`[LOG] ${outputDir}: Asset rewriting complete for ${filePath}`);

  // Ensure output directory exists before writing
  const outDir = dirname(outputPath);
  if (!existsSync(outDir)) {
    console.log(`[LOG] ${outputDir}: Creating output directory: ${outDir}`);
    mkdirSync(outDir, { recursive: true });
  }

  // Write the final HTML to the output file
  if (writeToFile) {
    writeFileSync(outputPath, html, 'utf8');
    console.log(`[LOG] Processed ${filePath} -> ${outputPath}`);
  }

  return html;
}

// Process each markdown file in the input directory
async function processDirectory(inputDir, outputDir) {
  const entries = readdirSync(inputDir);
  for (const entry of entries) {
    const entryPath = join(inputDir, entry);
    const outputPath = join(outputDir, entry);

    if (statSync(entryPath).isDirectory()) {
      // Recursively process subdirectories
      await processDirectory(entryPath, outputPath);
    } else if (entry.endsWith('index.md')) {
      // Process markdown files
      await processMarkdown(entryPath, outputPath.replace(/\.md$/, '.html'));
    }
  }
}

// Main execution
async function build(inputDir = '.', outputDir = '.') {
  // Default inputDir to '.' if not provided
  if (args[0]) {
    inputDir = args[0];
  }
  if (!existsSync(inputDir)) {
    console.error(`Input directory does not exist: ${inputDir}`);
    process.exit(1);
  }


  // Create output directory if it doesn't exist
  if (args[1]) {
    outputDir = args[1];
  }
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir);
  }

  console.log(`[LOG] build: Starting build with inputDir=${inputDir}, outputDir=${outputDir}`);
  await processDirectory(inputDir, outputDir);

  console.log('[LOG] build: Processing complete.');
}

build();

export { build, assetCache, AssetData };