const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const sharp = require('sharp');

// Import build.js functionality
const { processMarkdown } = require('./build.js');

// Load configuration from config.json
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    outputName: null,   // Auto-generate based on options
    videos: "external", // Default external videos, options are "external" (use the website's videos), true (pack videos in and scale them), false (no videos)
    mediaScale: 50,     // Default video scaling percentage
    scaleImages: false, // Optional scaling for non-icon images
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case "--external-videos":
        options.videos = "external";
        break;
      case "--no-videos":
        options.videos = false;
        break;
      case "--scale-images":
        options.scaleImages = true;
        break;
      case arg.startsWith("--media-scale="):
        // Extract scale value from --media-scale=50
        const scaleValue = arg.split("=")[1];
        options.mediaScale = parseInt(scaleValue) || 50; // Default to 50 if parsing fails
        break;
      case arg.startsWith("--output="):
        // Extract output name from --output=name.html
        options.outputName = arg.split("=")[1];
        break;
      case !arg.startsWith("--"):
        // Treat as output name if no -- prefix
        options.outputName = arg;
        break;
      default:
        // Handle other arguments if needed
        console.warn(`Unknown argument: ${arg}`);
        break;
    }
  }

  // Auto-generate output name if not provided
  if (!options.outputName) {
    const videoSuffix = options.videos === true ? "-packed" : "";
    options.outputName = `portfolio${videoSuffix}.html`;
  }

  return options;
}

// Get all page directories
function getPageDirectories() {
  const directories = ["."];  // Start with home page

  // Add subdirectories that contain index.md
  fs.readdirSync(".", { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name)
    .filter(name => !name.startsWith(".") &&
      !["node_modules", "media"].includes(name) &&
      fs.existsSync(path.join(name, "index.md")))
    .forEach(dir => directories.push(dir));

  return directories;
}

// Check for available hardware encoders
function detectHardwareEncoders() {
  try {
    const encoders = execSync('ffmpeg -encoders', { stdio: 'pipe' }).toString();
    const available = {
      nvidia: encoders.includes('h264_nvenc') || encoders.includes('hevc_nvenc'),
      amd: encoders.includes('h264_amf') || encoders.includes('hevc_amf'),
      intel: encoders.includes('h264_qsv') || encoders.includes('hevc_qsv'),
      apple: encoders.includes('h264_videotoolbox') || encoders.includes('hevc_videotoolbox')
    };
    return available;
  } catch (error) {
    console.warn('Warning: Could not detect hardware encoders');
    return { nvidia: false, amd: false, intel: false, apple: false };
  }
}

// Scale video using ffmpeg
async function scaleVideo(inputPath, ext, scalePercent) {
  if (scalePercent >= 100) {
    return fs.readFileSync(inputPath);
  }

  const tempDir = path.join(__dirname, "temp-video-scaling");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir);
  }

  const tempOutputPath = path.join(tempDir, `scaled_${Date.now()}${ext}`);
  const scaleFilter = `scale=iw*${scalePercent / 100}:ih*${scalePercent / 100}`;

  // Detect available hardware encoders
  const hwEncoders = detectHardwareEncoders();
  const encoderOptions = [];

  // Add hardware encoder options in priority order
  if (hwEncoders.nvidia) {
    encoderOptions.push({ codec: 'h264_nvenc', params: '-preset p1 -tune hq' });
  }
  if (hwEncoders.intel) {
    encoderOptions.push({ codec: 'h264_qsv', params: '-preset:v faster' });
  }
  if (hwEncoders.amd) {
    encoderOptions.push({ codec: 'h264_amf', params: '-quality speed' });
  }
  if (hwEncoders.apple) {
    encoderOptions.push({ codec: 'h264_videotoolbox', params: '-q:v 50' });
  }

  // Add the original software encoder as fallback
  encoderOptions.push({ codec: 'libvpx-vp9', params: '-crf 30 -b:v 0' });

  for (const encoder of encoderOptions) {
    try {
      const command = `ffmpeg -i "${inputPath}" -vf "${scaleFilter}" -c:v ${encoder.codec} ${encoder.params} -y "${tempOutputPath}"`;

      console.log(`  Scaling video to ${scalePercent}% using ${encoder.codec}: ${path.basename(inputPath)}`);
      execSync(command, { stdio: "pipe" });

      const scaledBuffer = fs.readFileSync(tempOutputPath);
      fs.unlinkSync(tempOutputPath); // Clean up temp file

      return scaledBuffer;
    } catch (error) {
      console.warn(`Warning: Could not scale video with ${encoder.codec}: ${error.message}`);
      if (encoder.codec !== 'libvpx-vp9') {
        console.log('  Trying next available encoder...');
        continue;
      }
    }
  }

  // All encoders failed, return original video
  console.warn(`Warning: All encoders failed, returning original video for ${path.basename(inputPath)}`);
  return fs.readFileSync(inputPath);
}

// Check if path is an icon
function isIconPath(filePath) {
  return filePath.includes("/favicons/");
}

// Use build.js to generate a page and return the HTML content
async function buildPageWithBuildJS(pageDir) {
  const indexPath = path.join(pageDir, "index.md");
  const outputPath = path.join(pageDir, "index.html"); // This won't be written since writeToFile=false

  try {
    // Run processMarkdown with writeToFile=false to get HTML
    const html = processMarkdown(indexPath, outputPath, false);
    return html;
  } catch (error) {
    console.error(`Error building page ${pageDir}:`, error);
    return null;
  }
}

// Extract head and body content separately
function extractPageSections(html) {
  const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/);
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/);

  return {
    head: headMatch ? headMatch[1] : '',
    body: bodyMatch ? bodyMatch[1] : '',
    fullHtml: html
  };
}

// Remove metadata comments and script tags
function stripMetadata(html) {
  // Remove og: properties and other metadata
  return html
    .replace(/\n?\s*<meta[^>]*property="og:[^"]*"[^>]*\/?>/gi, '')
    .replace(/\n?\s*<meta[^>]*name="twitter:[^"]*"[^>]*\/?>/gi, '')
    .replace(/\n?\s*<meta[^>]*property="article:[^"]*"[^>]*\/?>/gi, '');
}

// Merge head sections, handling duplicates and conflicts
function mergeHeadSections(homeHead, pageHeads) {
  let mergedHead = homeHead;

  // Extract existing links and styles from home head
  const existingLinks = new Set();
  const existingStyles = [];

  // Find existing stylesheets and inline styles
  const linkMatches = homeHead.match(/<link[^>]*href="[^"]*\.css"[^>]*>/g) || [];
  linkMatches.forEach(link => existingLinks.add(link));

  const styleMatches = homeHead.match(/<style[^>]*>[\s\S]*?<\/style>/g) || [];
  styleMatches.forEach(style => existingStyles.push(style));

  // Process each page's head section
  pageHeads.forEach(({ pageId, head }) => {
    // Extract page-specific styles and links
    const pageLinks = head.match(/<link[^>]*href="[^"]*\.css"[^>]*>/g) || [];
    const pageStyles = head.match(/<style[^>]*>[\s\S]*?<\/style>/g) || [];

    // Add unique CSS links
    pageLinks.forEach(link => {
      if (!existingLinks.has(link)) {
        existingLinks.add(link);
        // Insert before closing head or after last link
        const insertPoint = mergedHead.lastIndexOf('</head>') !== -1 ?
          mergedHead.lastIndexOf('</head>') : mergedHead.length;
        mergedHead = mergedHead.slice(0, insertPoint) + `\n    ${link}` + mergedHead.slice(insertPoint);
      }
    });

    // Add page-specific inline styles with page identifier
    pageStyles.forEach(style => {
      // Wrap styles to be page-specific
      const wrappedStyle = style.replace(
        /<style([^>]*)>/,
        `<style$1 data-page="${pageId}">`
      );

      // Scope the CSS rules to the page
      const scopedStyle = wrappedStyle.replace(
        /(<style[^>]*>)([\s\S]*?)(<\/style>)/,
        (match, openTag, cssContent, closeTag) => {
          // Add page-specific scoping to CSS rules
          const scopedCss = cssContent.replace(
            /([^{}]+)\s*{([^}]*)}/g,
            (rule, selectors, properties) => {
              // Don't scope @media, @keyframes, etc.
              if (selectors.trim().startsWith('@')) {
                return rule;
              }

              // Add page scope to selectors
              const scopedSelectors = selectors
                .split(',')
                .map(sel => `#page-${pageId} ${sel.trim()}`)
                .join(', ');

              return `${scopedSelectors} {${properties}}`;
            }
          );

          return `${openTag}${scopedCss}${closeTag}`;
        }
      );

      // Insert before closing head
      const insertPoint = mergedHead.lastIndexOf('</head>') !== -1 ?
        mergedHead.lastIndexOf('</head>') : mergedHead.length;
      mergedHead = mergedHead.slice(0, insertPoint) + `\n    ${scopedStyle}` + mergedHead.slice(insertPoint);
    });
  });

  return mergedHead;
}

// Process internal links to use hash navigation
function processLinks(html) {
  // Convert internal page links to hash-based navigation
  const regex = /<a([^>]*href="([^"]*)"[^>]*)>/g;

  html = html.replace(regex, (match, attributes, href) => {
    // Skip external links, anchors, and data URLs
    if (href.startsWith("http") || href.startsWith("#") || href.startsWith("data:") || href.startsWith("mailto:") || href.startsWith("tel:")) {
      return match;
    }

    // Handle relative paths to other pages
    if (href.endsWith("/") || href.endsWith("/index.html") || href.endsWith(".html")) {
      let pageId = href.replace(/\/$/, '').replace(/\/index\.html$/, '').replace(/\.html$/, '');

      // Handle root/home page
      if (pageId === '' || pageId === '.' || pageId === 'index') {
        pageId = 'home';
      }

      // Convert to hash navigation with onclick handler
      const newAttributes = attributes.replace(/href="[^"]*"/, `href="#${pageId}" onclick="showPage('${pageId}'); return true;"`);
      return `<a${newAttributes}>`;
    }

    return match;
  });

  return html;
}

// Main function that orchestrates all asset collection
async function collectAssets(html, pageDir, options) {
  // Find all asset files
  const regex = /(?<=")[^"]+\.([^"]+)(?=")/g;

  let processedHtml = html;

  let match;
  while ((match = regex.exec(html)) !== null) {
    const filePath = match[0];
    const fileExt = match[1].toLowerCase();

    // Check if file exists
    if (fs.existsSync(filePath)) {
      const asset = await collectAsset(filePath, pageDir, fileExt, options);

      if (asset) {
        // Replace the asset reference with variable usage
        const replacement = `getAsset("${asset.varName}")`;
        processedHtml = processedHtml.replace(filePath, replacement);
      }
    }
  }

  return processedHtml;
}

// Helper function to escape special regex characters
// function escapeRegExp(string) {
//   return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// }

// Global asset collection for optimization
const assetRegistry = new Map(); // path -> AssetData

// Asset data structure
class AssetData {
  constructor(data, fileType, encoding, varName) {
    this.data = data;           // The actual asset data
    this.fileType = fileType;   // File extension (css, js, png, etc.)
    this.encoding = encoding;   // How data is encoded: 'utf8', 'base64', 'url'
    this.varName = varName;     // Variable name for the asset
  }

  getMimeType() {
    return getMimeType(this.fileType);
  }

  getDataUrl() {
    if (this.encoding === 'url') {
      return this.data;
    }

    return `data:${this.getMimeType()};${this.encoding},${this.data}`;
  }
}

// Generate a unique variable name for an asset
function generateAssetVarName(filePath, pageDir) {
  // Get the relative path from project root and replace special characters with underscores
  const relativePath = path.relative('.', filePath);
  const varName = relativePath.replace(/[^\w\d]/g, '_');

  return varName;
}



// Collect asset for later processing
async function collectAsset(filePath, pageDir, fileType, options) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  let asset = new AssetData();

  // Use relative path as the key for checking if already processed
  const relativePath = path.relative('.', filePath);

  // Check if already registered
  if (assetRegistry.has(relativePath)) {
    asset = assetRegistry.get(relativePath);
  } else {
    // Generate variable name and collect asset data
    asset.varName = generateAssetVarName(filePath, pageDir);
    const imageScaleToUse = options.scaleImages && !isIconPath(filePath) ? options.mediaScale : 100;

    // Handle different file types
    let assetData;
    let encoding;

    switch (fileType) {
      case 'css':
      case 'js':
        asset.data = fs.readFileSync(filePath).toString("utf8");
        asset.encoding = 'utf8';
        break;
      case 'webm':
      case 'mp4':
        switch (options.videos) {
          case 'external':
            // For external videos, return the website's video URL
            asset.data = `${config.siteUrl}/${filePath}`;
            asset.encoding = 'url';
            break;
          case 'yes':
            // For packed videos, scale them
            asset.data = (await scaleVideo(filePath, fileType, options.mediaScale)).toString('base64');
            asset.encoding = 'base64';
            break;
          case 'no':
            // For no videos, use ffmpeg to get the first frame
            break;
        }
        break;
      case 'png':
      case 'jpg':
      case 'jpeg':
      case 'webp':
      case 'gif':
      case 'ico':
        // For images, scale if needed
        const fileBuffer = fs.readFileSync(filePath);
        const metadata = await sharp(fileBuffer).metadata();
        asset.data = (await sharp(fileBuffer)
          .resize({
            width: Math.round(metadata.width * imageScaleToUse / 100),
            height: Math.round(metadata.height * imageScaleToUse / 100)
          })
          .toBuffer()).toString('base64');
        asset.encoding = 'base64';
        break;
      case 'svg':
        // For SVGs, inline as text
        asset.data = fs.readFileSync(filePath).toString("utf8");
        asset.encoding = 'utf8';
        break;
    }

    if (asset.data) {
      console.log(`  📦 Collected asset: ${filePath} as "${asset.varName}" (${asset.encoding})`);
    }
  }

  return asset;
}

// Get MIME type based on file extension
function getMimeType(fileType) {
  switch (fileType) {
    case 'css': return 'text/css';
    case 'js': return 'application/javascript';
    case 'svg': return 'image/svg+xml';
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

// Generate the asset variables script
function generateAssetScript() {
  const assetVars = [];
  const assetMeta = {};

  for (const [filePath, asset] of assetRegistry) {
    switch (asset.encoding) {
      case 'utf8':
        // For text-based assets, store as text content
        assetVars.push(`const ${asset.varName} = \`${asset.data.replace(/`/g, '\\`')}\`;`);
        break;
      case 'base64':
        // For base64 encoded assets, store as data URL
        assetVars.push(`const ${asset.varName} = "${asset.getDataUrl()}";`);
        break;
      case 'url':
        // For URL assets, store as string
        assetVars.push(`const ${asset.varName} = "${asset.data}";`);
        break;
      default:
        // For other assets, store as data URL
        assetVars.push(`const ${asset.varName} = "${asset.getDataUrl()}";`);
        break;
    }

    assetMeta[asset.varName] = {
      fileType: asset.fileType,
      encoding: asset.encoding,
      usedBy: asset.usedBy
    };
  }

  return `
<script>
// Asset variables for optimized loading
${assetVars.join('\n')}

// Asset metadata for debugging
const assetMeta = ${JSON.stringify(assetMeta, null, 2)};

// Helper function to get asset data
function getAsset(varName) {
  return window[varName] || null;
}

// Helper function to create an image with an asset
function createImageWithAsset(varName, alt = '', className = '') {
  const asset = getAsset(varName);
  if (asset) {
    const img = document.createElement('img');
    img.src = asset;
    img.alt = alt;
    if (className) img.className = className;
    return img;
  }
  return null;
}

// Auto-load all assets on page load
document.addEventListener('DOMContentLoaded', function() {
  // Load images with data-asset attributes
  const assetImages = document.querySelectorAll('img[data-asset]');
  assetImages.forEach(function(img) {
    const assetName = img.getAttribute('data-asset');
    const assetData = getAsset(assetName);
    if (assetData) {
      img.src = assetData;
      console.log('📦 Loaded image asset:', assetName);
    } else {
      console.warn('⚠️ Image asset not found:', assetName);
    }
  });
  
  // Load CSS assets
  const cssAssets = document.querySelectorAll('[data-css]');
  cssAssets.forEach(function(element) {
    const assetName = element.getAttribute('data-css');
    const cssContent = getAsset(assetName);
    if (cssContent) {
      const style = document.createElement('style');
      style.textContent = cssContent;
      document.head.appendChild(style);
      element.removeAttribute('data-css'); // Clean up
      console.log('📦 Loaded CSS asset:', assetName);
    } else {
      console.warn('⚠️ CSS asset not found:', assetName);
    }
  });
  
  console.log('📦 Loaded', ${assetRegistry.size}, 'optimized assets total');
});
</script>`;
}

// Main build function
async function buildPortfolio() {
  const options = parseArgs();

  const pageDirectories = getPageDirectories();

  console.log(`\n📄 Found ${pageDirectories.length} pages: ${pageDirectories.join(', ')}`);

  // Clear asset registry for fresh build
  assetRegistry.clear();

  const allPages = [];
  const pageHeads = [];

  for (const pageDir of pageDirectories) {
    console.log(`\n🔨 Processing page: ${pageDir || 'home'}`);

    const html = await buildPageWithBuildJS(pageDir);
    if (html) {
      // Extract head and body sections
      const sections = extractPageSections(html);

      // Remove unnecessary metadata
      let processedHtml = stripMetadata(html);

      // Get all the assets in the page
      processedHtml = await collectAssets(html, pageDir, options);

      // Process internal links to use hash navigation
      processedHtml = processLinks(processedHtml);

      // Extract page title
      const titleMatch = processedHtml.match(/<title>([^<]*)<\/title>/);
      const pageTitle = titleMatch ? titleMatch[1] : config.siteTitle;

      const pageId = pageDir === '.' ? 'home' : pageDir;

      allPages.push({
        id: pageId,
        title: pageTitle,
        html: processedHtml,
        head: sections.head,
        body: sections.body
      });

      // Collect head sections for merging (except home page)
      if (pageId !== 'home') {
        pageHeads.push({
          pageId: pageId,
          head: sections.head
        });
      }

      console.log(`  ✅ Processed: ${pageDir || 'home'}`);
    } else {
      console.log(`  ❌ Failed to process: ${pageDir || 'home'}`);
    }
  }

  // Create unified single-page portfolio
  const homePage = allPages.find(p => p.id === 'home');
  if (!homePage) {
    console.error('❌ Home page not found!');
    return;
  }

  // Merge all head sections
  let mergedHead = mergeHeadSections(homePage.head, pageHeads);

  // Add navigation script
  const navigationScript = `
    <script>
      let currentPage = 'home';
      
      function showPage(pageId) {
        console.log('Switching to page:', pageId);
        
        // Hide all pages
        document.querySelectorAll('.page-section').forEach(section => {
          section.style.display = 'none';
        });
        
        // Show target page
        const targetSection = document.getElementById('page-' + pageId);
        if (targetSection) {
          targetSection.style.display = 'block';
          currentPage = pageId;
          
          // Update page title
          const pageData = ${JSON.stringify(allPages.map(p => ({ id: p.id, title: p.title })))};
          const page = pageData.find(p => p.id === pageId);
          if (page) {
            document.title = page.title;
          }
          
          // Update URL hash
          window.location.hash = pageId;
        }
      }
      
      // Handle back/forward navigation
      window.addEventListener('hashchange', function() {
        const hash = window.location.hash.slice(1) || 'home';
        if (hash !== currentPage) {
          showPage(hash);
        }
      });
      
      // Initialize on load
      document.addEventListener('DOMContentLoaded', function() {
        const hash = window.location.hash.slice(1) || 'home';
        if (hash !== 'home') {
          showPage(hash);
        }
      });
    </script>
  `;

  // Build the complete HTML structure
  let bodyContent = `<div class="page-section" id="page-home" style="display: block;">${homePage.body}</div>`;

  // Add other pages as hidden sections using their body content
  for (const page of allPages) {
    if (page.id !== 'home') {
      bodyContent += `<div class="page-section" id="page-${page.id}" style="display: none;">${page.body}</div>`;
    }
  }

  // Add navigation script before closing body
  bodyContent += navigationScript;

  // Construct the final HTML
  let portfolioHtml = `<!DOCTYPE html>
<html>
<head>
${mergedHead}
</head>
<body>
${bodyContent}
</body>
</html>`;

  // Add the asset variables script before the closing body tag
  const assetScript = generateAssetScript();
  portfolioHtml = portfolioHtml.replace('</body>', `${assetScript}\n</body>`);

  // Write the final portfolio file
  fs.writeFileSync(options.outputName, portfolioHtml);

  // Get file size
  const stats = fs.statSync(options.outputName);
  const fileSizeInMB = (stats.size / (1024 * 1024)).toFixed(1);

  console.log(`\n✅ Portfolio built successfully!`);
  console.log(`📁 File: ${options.outputName}`);
  console.log(`📊 Size: ${fileSizeInMB} MB`);
  console.log(`📄 Pages: ${allPages.length}`);

  switch (options.videos) {
    case "external":
      console.log(`🎥 Videos: Pointed to external videos from the website`);
      break;
    case true:
      console.log(`🎥 Videos: Packed and scaled to ${options.mediaScale}%`);
      break;
    case false:
      console.log(`🎥 Videos: Replaced with first frames`);
      break;
  }

  if (options.scaleImages) {
    console.log(`🖼️  Image scaling: ${options.mediaScale}%`);
  }

  // Clean up temp directory
  const tempDir = path.join(__dirname, 'temp-video-scaling');
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true });
  }
}

// Run the build
buildPortfolio().catch(console.error);
