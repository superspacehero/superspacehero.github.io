const fs = require('fs');
const fm = require('front-matter');
const { JSDOM } = require('jsdom');

const content = fs.readFileSync('index.md', 'utf8');
const parsed = fm(content);

console.log('Original markdown length:', parsed.body.length);
console.log('Original content starts with:', parsed.body.slice(0, 100));
console.log('Original content ends with:', parsed.body.slice(-200));

const template = fs.readFileSync('template.html', 'utf8');
const dom = new JSDOM(template, { runScripts: 'dangerously' });
const window = dom.window;

if (typeof window.processMarkdownContent === 'function') {
  console.log('Found processMarkdownContent function');
  try {
    const processed = window.processMarkdownContent(parsed.body);
    console.log('Processed content length:', processed.length);
    console.log('Processed content ends with:', processed.slice(-200));
    
    // Test marked.parse on the processed content
    const marked = require('marked');
    const finalHtml = marked.parse(processed);
    console.log('Final HTML length after marked.parse:', finalHtml.length);
    console.log('Final HTML ends with:', finalHtml.slice(-200));
  } catch (error) {
    console.error('Error during processing:', error);
  }
} else {
  console.log('No processMarkdownContent function found');
}
