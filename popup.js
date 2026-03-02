// Popup script for Instant Prompt Optimizer - Gemini Cloud API Version
document.addEventListener('DOMContentLoaded', async () => {
  const statusIndicator = document.getElementById('statusIndicator');
  const statusContent = document.getElementById('statusContent');
  const apiKeyInput = document.getElementById('apiKeyInput');
  const saveApiKeyBtn = document.getElementById('saveApiKey');
  const siteHostname = document.getElementById('siteHostname');
  const siteIndicator = document.getElementById('siteIndicator');
  const siteBadge = document.getElementById('siteBadge');
  const toggleSiteBtn = document.getElementById('toggleSiteBtn');
  const activatedSitesList = document.getElementById('activatedSitesList');

  let currentHostname = null;
  let currentTabId = null;
  let currentSiteStatus = { isDefault: false, isActivated: false };

  // Load existing API key
  try {
    const result = await chrome.storage.sync.get(['geminiApiKey']);
    if (result.geminiApiKey) {
      apiKeyInput.value = result.geminiApiKey;
      hideStatus();
    } else {
      updateStatus('error', 'Please configure your Gemini API key to start optimizing prompts.');
    }
  } catch (error) {
    console.error('Error loading configuration:', error);
    updateStatus('error', 'Error loading configuration. Please try again.');
  }

  // Detect current tab and show site status
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) {
      const url = new URL(tab.url);
      currentHostname = url.hostname.replace(/^www\./, '');
      currentTabId = tab.id;

      siteHostname.textContent = currentHostname;

      // Check site status via background script
      const status = await chrome.runtime.sendMessage({
        action: 'getSiteStatus',
        hostname: currentHostname
      });

      currentSiteStatus = status;
      updateSiteUI(status);
      displayActivatedSites(status.activatedSites || []);
    } else {
      siteHostname.textContent = 'No site detected';
      siteIndicator.className = 'site-indicator inactive';
    }
  } catch (error) {
    console.error('Error detecting current tab:', error);
    siteHostname.textContent = 'Unable to detect';
    siteIndicator.className = 'site-indicator inactive';
  }

  // Toggle site activation
  toggleSiteBtn.addEventListener('click', async () => {
    if (!currentHostname) return;

    toggleSiteBtn.disabled = true;

    try {
      if (currentSiteStatus.isActivated) {
        const result = await chrome.runtime.sendMessage({
          action: 'deactivateCurrentSite',
          hostname: currentHostname
        });
        currentSiteStatus.isActivated = false;
        updateSiteUI(currentSiteStatus);
        displayActivatedSites(result.sites || []);
      } else {
        const result = await chrome.runtime.sendMessage({
          action: 'activateCurrentSite',
          hostname: currentHostname,
          tabId: currentTabId
        });
        currentSiteStatus.isActivated = true;
        updateSiteUI(currentSiteStatus);
        displayActivatedSites(result.sites || []);
      }
    } catch (error) {
      console.error('Error toggling site:', error);
    } finally {
      toggleSiteBtn.disabled = false;
    }
  });

  function updateSiteUI(status) {
    if (status.isDefault) {
      siteIndicator.className = 'site-indicator active';
      toggleSiteBtn.style.display = 'none';
      siteBadge.textContent = 'Default site \u2014 always active';
      siteBadge.style.display = 'inline-block';
    } else if (status.isActivated) {
      siteIndicator.className = 'site-indicator active';
      toggleSiteBtn.textContent = 'Deactivate';
      toggleSiteBtn.className = 'btn btn-sm btn-danger';
      toggleSiteBtn.style.display = 'inline-flex';
      siteBadge.textContent = 'Manually activated';
      siteBadge.style.display = 'inline-block';
    } else {
      siteIndicator.className = 'site-indicator inactive';
      toggleSiteBtn.textContent = 'Activate';
      toggleSiteBtn.className = 'btn btn-sm';
      toggleSiteBtn.style.display = 'inline-flex';
      siteBadge.style.display = 'none';
    }
  }

  function createRemoveIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');

    const line1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line1.setAttribute('x1', '18'); line1.setAttribute('y1', '6');
    line1.setAttribute('x2', '6'); line1.setAttribute('y2', '18');

    const line2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line2.setAttribute('x1', '6'); line2.setAttribute('y1', '6');
    line2.setAttribute('x2', '18'); line2.setAttribute('y2', '18');

    svg.appendChild(line1);
    svg.appendChild(line2);
    return svg;
  }

  function displayActivatedSites(sites) {
    activatedSitesList.replaceChildren();
    if (!sites || sites.length === 0) return;

    sites.forEach((hostname, index) => {
      const item = document.createElement('div');
      item.className = 'activated-site-item';
      item.style.animationDelay = `${index * 50}ms`;

      const indicator = document.createElement('div');
      indicator.className = 'activated-site-indicator';

      const info = document.createElement('div');
      info.className = 'activated-site-info';
      const urlSpan = document.createElement('span');
      urlSpan.className = 'activated-site-url';
      urlSpan.textContent = hostname;
      info.appendChild(urlSpan);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'remove-site-btn';
      removeBtn.title = 'Remove ' + hostname;
      removeBtn.appendChild(createRemoveIcon());

      removeBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        item.style.transform = 'translateX(100%)';
        item.style.opacity = '0';
        item.style.transition = 'all 0.2s ease';

        setTimeout(async () => {
          try {
            const result = await chrome.runtime.sendMessage({
              action: 'deactivateCurrentSite',
              hostname
            });
            displayActivatedSites(result.sites || []);
            if (hostname === currentHostname) {
              currentSiteStatus.isActivated = false;
              updateSiteUI(currentSiteStatus);
            }
          } catch (error) {
            console.error('Error removing site:', error);
            item.style.transform = '';
            item.style.opacity = '';
          }
        }, 200);
      });

      item.appendChild(indicator);
      item.appendChild(info);
      item.appendChild(removeBtn);
      activatedSitesList.appendChild(item);
    });
  }

  // Save API key functionality
  saveApiKeyBtn.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();

    if (!apiKey) {
      alert('Please enter a valid API key.');
      return;
    }

    if (!apiKey.startsWith('AIza') || apiKey.length < 30) {
      alert('Invalid API key format. Please check your Gemini API key.');
      return;
    }

    try {
      saveApiKeyBtn.disabled = true;
      apiKeyInput.classList.remove('valid', 'invalid');

      const isValid = await testApiKey(apiKey);

      if (isValid) {
        await chrome.storage.sync.set({ geminiApiKey: apiKey });
        updateStatus('ready', 'API key saved successfully!');
        apiKeyInput.classList.add('valid');
        hideStatus();
      } else {
        apiKeyInput.classList.add('invalid');
        updateStatus('error', 'Invalid API key. Please check your Gemini API key and try again.');
        alert('API key validation failed. Please check your key and try again.');
      }
    } catch (error) {
      console.error('Error saving API key:', error);
      apiKeyInput.classList.add('invalid');
      updateStatus('error', 'Error saving API key. Please try again.');
      alert('Error saving API key. Please try again.');
    } finally {
      saveApiKeyBtn.disabled = false;
    }
  });

  apiKeyInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') saveApiKeyBtn.click();
  });

  apiKeyInput.addEventListener('input', (e) => {
    const value = e.target.value.trim();
    apiKeyInput.classList.remove('valid', 'invalid');
    if (value.length === 0) return;
    if (value.startsWith('AIza') && value.length >= 30) {
      apiKeyInput.classList.add('valid');
    } else {
      apiKeyInput.classList.add('invalid');
    }
  });

  function updateStatus(type, message) {
    const statusSection = document.querySelector('.status');
    statusSection.style.display = 'flex';
    statusIndicator.className = `status-indicator status-${type}`;
    statusContent.textContent = message;
  }

  function hideStatus() {
    const statusSection = document.querySelector('.status');
    statusSection.style.display = 'none';
  }

  async function testApiKey(apiKey) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemma-3-27b-it:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Hello' }] }]
        })
      });
      return response.ok;
    } catch (error) {
      console.error('API key test failed:', error);
      return false;
    }
  }
});
