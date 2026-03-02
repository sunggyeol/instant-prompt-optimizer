// Background script for Instant Prompt Optimizer

const DEFAULT_SITES = [
  'claude.ai', 'chatgpt.com', 'chat.openai.com',
  'perplexity.ai', 'gemini.google.com', 'meta.ai',
  'grok.com', 'copilot.microsoft.com'
];

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'updateActivatedSites') {
    chrome.storage.sync.set({ activatedSites: request.sites });
    sendResponse({ success: true });
  }

  if (request.action === 'activateCurrentSite') {
    const hostname = request.hostname;
    chrome.storage.sync.get(['activatedSites'], (result) => {
      const sites = result.activatedSites || [];
      if (!sites.includes(hostname)) {
        sites.push(hostname);
        chrome.storage.sync.set({ activatedSites: sites }, () => {
          // Inject content script into the current tab
          if (request.tabId) {
            injectContentScript(request.tabId);
          }
          sendResponse({ success: true, sites });
        });
      } else {
        sendResponse({ success: true, sites });
      }
    });
    return true; // async response
  }

  if (request.action === 'deactivateCurrentSite') {
    const hostname = request.hostname;
    chrome.storage.sync.get(['activatedSites'], (result) => {
      const sites = (result.activatedSites || []).filter(s => s !== hostname);
      chrome.storage.sync.set({ activatedSites: sites }, () => {
        sendResponse({ success: true, sites });
      });
    });
    return true; // async response
  }

  if (request.action === 'getSiteStatus') {
    const hostname = request.hostname;
    const isDefault = DEFAULT_SITES.some(site => hostname.includes(site) || site.includes(hostname));
    chrome.storage.sync.get(['activatedSites'], (result) => {
      const activatedSites = result.activatedSites || [];
      const isActivated = activatedSites.includes(hostname);
      sendResponse({ isDefault, isActivated, activatedSites });
    });
    return true; // async response
  }

  return true;
});

// Inject content script into tabs when they are activated or updated
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  await checkAndInjectContentScript(activeInfo.tabId);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    await checkAndInjectContentScript(tabId);
  }
});

async function checkAndInjectContentScript(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('moz-extension://') || tab.url.startsWith('edge://')) {
      return;
    }

    const url = new URL(tab.url);
    const hostname = url.hostname;

    // Check if this is a default site (already handled by manifest content_scripts)
    const isDefaultSite = DEFAULT_SITES.some(site => hostname.includes(site));
    if (isDefaultSite) return; // manifest handles these

    // Check if user has activated this site
    const result = await chrome.storage.sync.get(['activatedSites']);
    const activatedSites = result.activatedSites || [];
    const isActivated = activatedSites.some(site => hostname.includes(site) || site.includes(hostname));

    if (isActivated) {
      await injectContentScript(tabId);
    }
  } catch (error) {
    console.log('Error in checkAndInjectContentScript:', error);
  }
}

async function injectContentScript(tabId) {
  try {
    // Check if content script is already injected
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => window.promptOptimizerInjected
    });

    if (!results[0]?.result) {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js']
      });

      await chrome.scripting.insertCSS({
        target: { tabId },
        files: ['styles.css']
      });

      await chrome.scripting.executeScript({
        target: { tabId },
        func: () => { window.promptOptimizerInjected = true; }
      });
    }
  } catch (error) {
    console.log('Could not inject content script:', error);
  }
}

chrome.runtime.onStartup.addListener(() => {});
chrome.runtime.onInstalled.addListener(() => {});
