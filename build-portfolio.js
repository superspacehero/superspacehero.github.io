import { readFileSync, readdirSync, existsSync, writeFileSync } from 'fs';
import { basename, dirname, extname, join, relative, resolve } from 'path';
import sharp from 'sharp';
import { JSDOM } from 'jsdom';

// Import build.js functionality directly as ES module
import { build, assetCache, AssetData } from './build.js';

// Load configuration from config.json
const config = JSON.parse(readFileSync('./config.json', 'utf8'));

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  rebuildSite: false, // Default to not rebuilding the site
  outputName: `portfolio.html`,   // Default output name
  externalVideos: true, // Default external videos, true (use the website's videos), false (no videos)
  mediaScale: 50,     // Default media scaling percentage
  scaleImages: false, // Optional scaling for non-icon images
};

if (args.length > 0) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case "--rebuild":
        options.rebuildSite = true;
        break;
      case "--external-videos":
        options.externalVideos = true;
        break;
      case "--no-videos":
        options.externalVideos = false;
        break;
      case "--scale-images":
        options.scaleImages = true;
        break;
      default:
        if (arg.startsWith("--media-scale=")) {
          // Extract scale value from --media-scale=50
          const scaleValue = arg.split("=")[1];
          options.mediaScale = parseInt(scaleValue) || 50; // Default to 50 if parsing fails
        } else if (arg.startsWith("--output=")) {
          // Extract output name from --output=name.html
          options.outputName = arg.split("=")[1];
          if (!options.outputName) {
            console.error("Output name must be specified with --output=name.html");
            process.exit(1);
          }
        } else if (!arg.startsWith("--")) {
          // Treat as output name if no -- prefix
          options.outputName = arg;
        } else {
          console.warn(`build-portfolio.js: '${arg}' not recognized`);
        }
        break;
    }
  }
}

// Add getPageId helper function
function toVariable(text) {
  if (text === '.') {
    text = 'home';
  }
  return text.replace(/[^\w\d]/g, '_');
}

// Process an asset file, inlining it and scaling it if requested and an image
async function processAsset(baseDir, filePath) {
  filePath = resolve(baseDir, filePath); // Resolve to absolute path
  if (!existsSync(filePath)) {
    console.error(`[ERR] File not found: ${filePath}`);
    return null;
  }

  const fileExt = extname(filePath).slice(1).toLowerCase();
  let asset = new AssetData(fileExt, 'utf8');
  let fileContent;

  switch (fileExt) {
    case 'html':
      if (basename(filePath) === 'index.html') {
        // Convert index.html to a hash link
        return `#${toVariable(dirname(filePath))}`;
      }
      break;
    case 'css':
    case 'js':
    case 'webmanifest':
    case 'json':
      asset.varName = `${toVariable(filePath)}`;
      fileContent = readFileSync(filePath);
      asset.data = fileContent.toString();
      break;
    case 'svg':
      asset.varName = `${toVariable(filePath)}`;
      fileContent = readFileSync(filePath);
      asset.data = await findAssets(fileContent.toString(), dirname(filePath));
      asset.encoding = 'utf8';
      break;
    default:
      // For images, scale them if requested
      const imageFormats = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'ico'];
      const imageScale = imageFormats.includes(fileExt) && options.scaleImages && !filePath.includes('/favicons/') ? options.mediaScale : 100;
      if (imageScale < 100) {
        console.log(`Scaling ${filePath}`);
        asset.data = await sharp(filePath).metadata()
          .then(metadata => {
            const width = Math.round(metadata.width * (imageScale / 100));
            const height = Math.round(metadata.height * (imageScale / 100));
            return sharp(filePath).resize(width, height).toBuffer();
          });
      } else {
        console.log(`Processing ${filePath}`);
        asset.data = readFileSync(filePath);
      }
      asset.encoding = 'base64';
      asset.varName = `${toVariable(filePath)}`;
      asset.fileType = fileExt;
      break;
  }

  assetCache[asset.varName] = asset;
  return asset.varName;
}

// Look for assets within the given text
async function findAssets(text, baseDir = '.') {
  const dom = new JSDOM(text);
  const document = dom.window.document;
  // Process all elements with src, href, or data-src attributes
  const assetAttrs = ['src', 'href', 'data-src', 'poster'];
  document.querySelectorAll('*').forEach(async el => {
    for (const attrName of assetAttrs) {
      const attrValue = el.getAttribute && el.getAttribute(attrName);
      if (!attrValue || attrValue.startsWith('http') || attrValue.startsWith('mailto:') || attrValue.startsWith('tel:')) continue;
      // Always resolve the asset path relative to the current page directory, and normalize it
      const resolvedPath = resolve(baseDir, attrValue); // absolute path
      const normalizedPath = relative('.', resolvedPath); // relative to project root, normalized
      const filePath = normalizedPath;

      if (!existsSync(filePath)) continue;
      el.setAttribute(attrName, await processAsset(baseDir, filePath));
    }
  });
  return dom.serialize();
}

async function main() {
  const pageDirectories = ["."];

  // Build the site first if rebuildSite is enabled
  if (options.rebuildSite) {
    console.log('\n[LOG] Rebuilding site...');
    await build();
    console.log('[LOG] Site rebuild completed.\n');
  }

  // Get all page directories
  // Add subdirectories that contain index.html
  readdirSync(".", { withFileTypes: true })
    .filter(function (dirent) { return dirent.isDirectory(); })
    .map(function (dirent) { return dirent.name; })
    .filter(function (name) {
      return !name.startsWith(".") && existsSync(join(name, "index.html"));
    })
    .forEach(function (dir) { pageDirectories.push(dir); });

  console.log(`[LOG] build: Found ${pageDirectories.length} pages: ${pageDirectories.join(', ')}`);

  let portfolioDom = null;

  if (pageDirectories.length > 0) {
    // Use the first directory's page as a basis for the portfolio
    const firstPageId = toVariable(pageDirectories[0]);
    console.log(`[LOG] build: Using first page as portfolio base: ${firstPageId}`);
    portfolioDom = new JSDOM(readFileSync(join(pageDirectories[0], 'index.html'), 'utf8'));
  }

  if (!portfolioDom) {
    console.error("[ERR] build: No valid page directories found. Exiting.");
    process.exit(1);
  }

  // Strip out existing stylesheets
  const stylesheets = portfolioDom.window.document.querySelectorAll('link[rel="stylesheet"]');
  stylesheets.forEach(link => link.remove());

  // Strip out all 'og' metadata
  const metaTags = portfolioDom.window.document.querySelectorAll('meta[property="og:"]');
  metaTags.forEach(tag => tag.remove());

  // Strip out 'wrap' elements
  let content = portfolioDom.window.document.querySelectorAll('.wrap');
  content.forEach(wrap => wrap.remove());

  // Add behavior to only show the current page section based on the hash
  const main = portfolioDom.window.document.createElement('main');
  portfolioDom.window.document.body.appendChild(main);

  // Add navigation script for hash-based section display and stylesheet management
  const navigation = portfolioDom.window.document.createElement('script');
  main.appendChild(navigation);
  navigation.textContent = `
// Hash-based navigation and per-section stylesheet switching
function showSectionByHash() {
  var hash = (window.location.hash || '#home').substring(1);
  var sections = document.querySelectorAll('main > section');
  var found = false;
  sections.forEach(function(section) {
    if (section.id === hash) {
      section.style.display = 'block';
      found = true;
      // Remove all current section stylesheets
      document.querySelectorAll('link[data-section-style]').forEach(function(l) { l.remove(); });
      // Add this section's stylesheets
      var sheetHrefs = (section.getAttribute('data-stylesheets') || '').split(',').filter(Boolean);
      sheetHrefs.forEach(function(href) {
        if (!document.head.querySelector('link[data-section-style][href="' + href + '"]')) {
          var link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = href;
          link.setAttribute('data-section-style', section.id);
          document.head.appendChild(link);
        }
      });
      document.title = section.title || 'Portfolio';
    } else {
      section.style.display = 'none';
    }
  });
  // If no section found, show the first
  if (!found && sections.length > 0) {
    sections.forEach(function(section, i) {
      section.style.display = i === 0 ? 'block' : 'none';
      if (i === 0) {
        document.querySelectorAll('link[data-section-style]').forEach(function(l) { l.remove(); });
        var sheetHrefs = (section.getAttribute('data-stylesheets') || '').split(',').filter(Boolean);
        sheetHrefs.forEach(function(href) {
          if (!document.head.querySelector('link[data-section-style][href="' + href + '"]')) {
            var link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = href;
            link.setAttribute('data-section-style', section.id);
            document.head.appendChild(link);
          }
        });
        document.title = section.title || 'Portfolio';
      }
    });
  }
}
window.addEventListener('hashchange', showSectionByHash);
window.addEventListener('DOMContentLoaded', showSectionByHash);
`;

  // Process each page directory
  const pages = [];
  for (const dir of pageDirectories) {
    const pageId = toVariable(dir);
    const filePath = join(dir, 'index.html');
    if (!existsSync(filePath)) {
      console.warn(`Skipping ${filePath} as it does not exist.`);
      continue;
    }

    // Read the HTML content
    const pageDom = new JSDOM(readFileSync(filePath, 'utf8'));

    const section = portfolioDom.window.document.createElement('section');
    section.id = pageId;
    section.title = pageDom.window.document.title;


    // Collect stylesheet hrefs for this section
    const stylesheets = pageDom.window.document.querySelectorAll('link[rel="stylesheet"]');
    const hrefs = [];
    stylesheets.forEach(link => {
      if (link.href) {
        // Use relative path if possible
        let href = link.getAttribute('href') || link.href;
        hrefs.push(href);
      }
    });
    section.setAttribute('data-stylesheets', hrefs.join(','));

    // Get the page content
    content = pageDom.window.document.querySelectorAll('.wrap');

    if (content.length > 0) {
      // Add content to the section
      content.forEach(wrap => {
        const wrapClone = wrap.cloneNode(true);
        section.appendChild(wrapClone);
      });
    } else {
      // Get the body content if no .wrap elements found
      section.innerHTML = pageDom.window.document.body.innerHTML;
    }

    // Process assets in the section content
    section.innerHTML = await findAssets(section.innerHTML, dir);

    // Push the processed page data
    pages.push(section);
  }

  // Append the processed pages to the portfolio document
  pages.forEach(page => {
    portfolioDom.window.document.querySelector('main').appendChild(page);
  });

  // Add the assets to the document head
  for (const varName in assetCache) {
    const asset = assetCache[varName];
    const link = portfolioDom.window.document.createElement(varName);
    link.href = asset.getDataUrl();
    portfolioDom.window.document.head.appendChild(link);
  }

  // Serialize the final HTML document
  const finalHtml = portfolioDom.serialize();

  // Write the final HTML to the output file
  writeFileSync(options.outputName, finalHtml, 'utf8');
  console.log(`[LOG] build: Portfolio built successfully: ${options.outputName}`);
}

// Run the main function
main().catch(err => {
  console.error(`[ERR] build: Couldn't build portfolio:`, err);
  process.exit(1);
});