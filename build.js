const fs = require('fs');
const path = require('path');
const marked = require('marked');
const fm = require('front-matter');
const { JSDOM } = require('jsdom');
const sharp = require('sharp');

const template = fs.readFileSync('template.html', 'utf8');
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));

function processMarkdown(filePath, outputPath, writeToFile = true) {
  let content = fs.readFileSync(filePath, 'utf8');
  
  let parsed = fm(content);
  
  // Calculate relative path and phone URL once
  const depth = (outputPath.match(/\//g) || []).length;
  const relativePath = depth > 0 ? '../'.repeat(depth) : '';
  const phoneURL = config.phone ? `tel:${config.phone.replace(/[^0-9]/g, '')}` : '';
  
  // Process {{ABOUT}} placeholder before any other processing
  // Replace placeholders in the expanded {{ABOUT}} content before markdown processing
  let aboutContent = `# Info\n\n## {{DOWNLOAD}}\n\n{{DESCRIPTION}}`;
  aboutContent = aboutContent.replace(/\{\{DOWNLOAD\}\}/g, parsed.attributes.download || '');
  aboutContent = aboutContent.replace(/\{\{DESCRIPTION\}\}/g, parsed.attributes.description || config.siteDescription);
  
  parsed.body = parsed.body.replace(/\{\{ABOUT\}\}/g, aboutContent);

  // Replace all content placeholders before markdown processing
  parsed.body = parsed.body.replace(/\{\{FIRST_NAME\}\}/g, config.firstName || '');
  parsed.body = parsed.body.replace(/\{\{LAST_NAME\}\}/g, config.lastName || '');

  parsed.body = parsed.body.replace(/\{\{SITE\}\}/g, config.siteUrl || '');
  parsed.body = parsed.body.replace(/\{\{EMAIL\}\}/g, config.email || '');
  parsed.body = parsed.body.replace(/\{\{PHONE\}\}/g, config.phone || '');
  parsed.body = parsed.body.replace(/\{\{PHONE_URL\}\}/g, phoneURL);
  parsed.body = parsed.body.replace(/\{\{GITHUB\}\}/g, config.github || '');
  parsed.body = parsed.body.replace(/\{\{LINKEDIN\}\}/g, config.linkedin || '');
  parsed.body = parsed.body.replace(/\{\{SUBTITLE\}\}/g, parsed.attributes.subtitle || config.siteSubtitle || '');
  parsed.body = parsed.body.replace(/\{\{DESCRIPTION\}\}/g, parsed.attributes.description || config.siteDescription);
  parsed.body = parsed.body.replace(/\{\{DOWNLOAD\}\}/g, parsed.attributes.download || '');
  parsed.body = parsed.body.replace(/\{\{BASE_PATH\}\}/g, relativePath);

  // Check for local template.html in the same directory
  const dir = path.dirname(filePath);
  const localTemplatePath = path.join(dir, 'template.html');
  let currentTemplate = template; // Default to global template
  
  if (fs.existsSync(localTemplatePath)) {
    currentTemplate = fs.readFileSync(localTemplatePath, 'utf8');
    console.log(`Using local template: ${localTemplatePath}`);
  }
  
  // Create JSDOM instance to execute template's processMarkdownContent function
  const dom = new JSDOM(currentTemplate, { runScripts: "dangerously" });
  const window = dom.window;
  
  let htmlContent;
  
  // Check if the template has a processMarkdownContent function and use it
  if (typeof window.processMarkdownContent === 'function') {
    // First apply template-specific processing (for grids, custom elements)
    const processedContent = window.processMarkdownContent(parsed.body);
    // Then process remaining markdown with marked
    htmlContent = marked.parse(processedContent);
    console.log('Using template-specific markdown processing + marked');
  } else {
    console.log('No template-specific markdown processing found, using marked.parse only');
    htmlContent = marked.parse(parsed.body);
  }
  
  let html = currentTemplate;
  
  // Use config for site title and append page title
  const pageTitle = parsed.attributes.pageTitle || parsed.attributes.title || config.siteTitle;
  const fullTitle = pageTitle.includes(config.siteTitle) ? pageTitle : `${config.siteTitle} - ${pageTitle}`;
  const fullURL = new URL(outputPath.replace(/\\/g, '/'), config.siteUrl).href;
  
  // Create the favicon links HTML
  const faviconLinks = `
    <link rel="apple-touch-icon" sizes="180x180" href="${relativePath}media/favicons/apple-touch-icon.png" />
    <link rel="icon" type="image/png" sizes="32x32" href="${relativePath}media/favicons/favicon-32x32.png" />
    <link rel="icon" type="image/png" sizes="16x16" href="${relativePath}media/favicons/favicon-16x16.png" />
    <link rel="manifest" href="${relativePath}media/favicons/site.webmanifest" />`;

  // Replace all placeholders with global regex
  html = html.replace(/\{\{FULL_TITLE\}\}/g, fullTitle);
  html = html.replace(/\{\{PAGE_TITLE\}\}/g, parsed.attributes.pageTitle || parsed.attributes.title || config.siteTitle);
  html = html.replace(/\{\{TITLE\}\}/g, parsed.attributes.title || config.siteTitle);
  html = html.replace(/\{\{SUBTITLE\}\}/g, parsed.attributes.subtitle || config.siteSubtitle);

  html = html.replace(/\{\{FIRST_NAME\}\}/g, config.firstName || '');
  html = html.replace(/\{\{LAST_NAME\}\}/g, config.lastName || '');
  html = html.replace(/\{\{EMAIL\}\}/g, config.email || '');
  html = html.replace(/\{\{PHONE\}\}/g, config.phone || '');
  html = html.replace(/\{\{PHONE_URL\}\}/g, phoneURL);
  html = html.replace(/\{\{GITHUB\}\}/g, config.github || '');
  html = html.replace(/\{\{BLUESKY\}\}/g, config.bluesky || '');
  html = html.replace(/\{\{LINKEDIN\}\}/g, config.linkedin || '');

  html = html.replace(/\{\{DESCRIPTION\}\}/g, parsed.attributes.description || config.siteDescription);
  html = html.replace(/\{\{DOWNLOAD\}\}/g, parsed.attributes.download || '');
  html = html.replace(/\{\{URL\}\}/g, fullURL);

  html = html.replace(/\{\{BASE_PATH\}\}/g, relativePath);
  html = html.replace(/\{\{FAVICON_LINKS\}\}/g, faviconLinks);
  
  // Video assets should be local to each page's directory, not relative to root
  const videoSource = parsed.attributes.video_source || 'media/videos/Hero.webm';
  const videoPoster = parsed.attributes.video_poster || 'media/videos/Hero.png';
  // Generate MP4 fallback from webm source
  const videoSourceMp4 = videoSource.replace('.webm', '.mp4');
  html = html.replace(/\{\{VIDEO_POSTER\}\}/g, videoPoster);
  html = html.replace(/\{\{VIDEO_SOURCE\}\}/g, videoSource);
  html = html.replace(/\{\{VIDEO_SOURCE_MP4\}\}/g, videoSourceMp4);
  
  // Handle buttons array
  const buttons = parsed.attributes.buttons || ['', '', '', ''];
  html = html.replace(/\{\{BUTTON_TOP_LEFT\}\}/g, buttons[0]);
  html = html.replace(/\{\{BUTTON_TOP_RIGHT\}\}/g, buttons[1]);
  html = html.replace(/\{\{BUTTON_BOTTOM_LEFT\}\}/g, buttons[2]);
  html = html.replace(/\{\{BUTTON_BOTTOM_RIGHT\}\}/g, buttons[3]);

  html = html.replace(/\{\{CONTENT\}\}/g, htmlContent);
  
  // Remove the processMarkdownContent function from the final HTML (it's only needed during build)
  // Be more specific to avoid matching script tags in content
  html = html.replace(/<script>\s*\/\/[^\n]*\n[^<]*function processMarkdownContent[\s\S]*?<\/script>/g, '');
  
  // Only add relative path prefix to assets that are clearly parent directory references
  // Exclude: http/https URLs, fragments (#), current directory (./) and simple filenames
  // Video sources and posters should remain local to each page's directory
  html = html.replace(/href="(?!http|#|\.\/)[^"]*\.css/g, (match) => match.replace('href="', `href="${relativePath}`));
  html = html.replace(/href="(?!http|#|\.\/)[^"]*\.js/g, (match) => match.replace('href="', `href="${relativePath}`));
  html = html.replace(/src="(?!http|\.\/|media\/videos\/)[^"]*\.(css|js|png|ico|webmanifest)/g, (match) => match.replace('src="', `src="${relativePath}`));
  // Note: Removed webm|mp4 from src and removed poster entirely - they should stay local
  
  if (writeToFile) {
    fs.writeFileSync(outputPath, html);
    console.log(`Generated: ${outputPath}`);
  }
  
  return html;
}

function findMarkdownFiles(dir, baseDir = '') {
  const files = fs.readdirSync(dir);
  files.forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory() && !file.startsWith('.')) {
      findMarkdownFiles(fullPath, path.join(baseDir, file));
    } else if (file === 'index.md') {
      const outputPath = path.join(baseDir, 'index.html');
      processMarkdown(fullPath, outputPath);
    }
  });
}

function generateFavicons() {
  const faviconSource = path.join('media', 'favicons', 'favicon.png');
  const outputDir = path.join('media', 'favicons');
  
  // Ensure the favicon.png exists
  if (!fs.existsSync(faviconSource)) {
    console.error(`Error: Source favicon not found at ${faviconSource}`);
    return;
  }
  
  console.log('Generating favicons from:', faviconSource);
  
  // Define the favicon sizes to generate
  const favicons = [
    { name: 'favicon-16x16.png', size: 16 },
    { name: 'favicon-32x32.png', size: 32 },
    { name: 'android-chrome-192x192.png', size: 192 },
    { name: 'android-chrome-512x512.png', size: 512 },
    { name: 'apple-touch-icon.png', size: 180 },
  ];
  
  // Generate each favicon
  favicons.forEach(icon => {
    const outputPath = path.join(outputDir, icon.name);
    sharp(faviconSource)
      .resize(icon.size, icon.size)
      .toFile(outputPath)
      .then(() => {
        console.log(`Generated: ${icon.name} (${icon.size}x${icon.size})`);
      })
      .catch(err => {
        console.error(`Error generating ${icon.name}:`, err);
      });
  });
  
  // Generate favicon.ico (contains multiple sizes: 16x16, 32x32, 48x48)
  const icoSizes = [16, 32, 48];
  const icoOutputPath = path.join(outputDir, 'favicon.ico');
  
  // Use sharp to create the .ico file with multiple sizes
  Promise.all(
    icoSizes.map(size => 
      sharp(faviconSource)
        .resize(size, size)
        .toBuffer()
    )
  ).then(buffers => {
    // Use the ICO plugin of sharp if available
    // This is a simplified approach; in production, you might want to use a dedicated ICO library
    const icoBuffer = Buffer.concat(buffers);
    fs.writeFileSync(icoOutputPath, icoBuffer);
    console.log(`Generated: favicon.ico (${icoSizes.join('x')})`);
    
    // Create or update site.webmanifest
    generateWebManifest(outputDir);
  }).catch(err => {
    console.error('Error generating favicon.ico:', err);
  });
}

function generateWebManifest(outputDir) {
  const webmanifestPath = path.join(outputDir, 'site.webmanifest');
  
  // Resolve placeholders in siteTitle
  const resolvedSiteTitle = (config.siteTitle || '')
    .replace(/\{\{FIRST_NAME\}\}/g, config.firstName || '')
    .replace(/\{\{LAST_NAME\}\}/g, config.lastName || '');
  
  const manifest = {
    name: resolvedSiteTitle,
    short_name: config.siteShortName || '',
    icons: [
      {
        src: '/media/favicons/android-chrome-192x192.png',
        sizes: '192x192',
        type: 'image/png'
      },
      {
        src: '/media/favicons/android-chrome-512x512.png',
        sizes: '512x512',
        type: 'image/png'
      }
    ],
    theme_color: config.themeColor || '#ffffff',
    background_color: config.backgroundColor || '#ffffff',
    display: 'standalone'
  };
  
  fs.writeFileSync(webmanifestPath, JSON.stringify(manifest, null, 2));
  console.log('Generated: site.webmanifest');
}

// Generate favicons before processing markdown files
generateFavicons();

findMarkdownFiles('.');

// Export functions for use by other modules
module.exports = {
  processMarkdown,
  findMarkdownFiles,
  generateFavicons,
  generateWebManifest
};
