// Instant Prompt Optimizer Content Script - Gemini Cloud API Version
class PromptOptimizer {
  constructor() {
    this.selectedText = '';
    this.selectionRange = null;
    this.optimizationPopup = null;
    this.apiKey = null;
    this.isOptimizing = false; // Track if an optimizing request is in progress
    this.justClosed = false; // Track if popup was just closed to prevent immediate reopening
    
    this.init();
  }

  async init() {
    // Load API key from storage
    try {
      const result = await chrome.storage.sync.get(['geminiApiKey']);
      this.apiKey = result.geminiApiKey;
      
      if (!this.apiKey) {
        console.warn('Instant Prompt Optimizer: No Gemini API key found. Please configure in extension popup.');
      }
    } catch (error) {
      console.error('Instant Prompt Optimizer: Error loading API key:', error);
    }

    // Try to restore any pending optimization state
    await this.restoreOptimizationState();

    // Set up event listeners
    document.addEventListener('mouseup', this.handleTextSelection.bind(this));
    document.addEventListener('keyup', this.handleTextSelection.bind(this));
    document.addEventListener('mousedown', this.handleMouseDown.bind(this));
    document.addEventListener('input', this.handleInputChange.bind(this), true);
    
    // Listen for API key updates
    chrome.storage.onChanged.addListener((changes) => {
      if (changes.geminiApiKey) {
        this.apiKey = changes.geminiApiKey.newValue;
      }
    });
    
    // Clean up old optimization data (older than 1 hour)
    this.cleanupOldOptimizations();
  }

  handleTextSelection(event) {
    // Prevent handling new selections during active refinement
    if (this.isOptimizing) {
      return;
    }
    
    // Prevent reopening immediately after closing
    if (this.justClosed) {
      return;
    }
    
    // Small delay to ensure selection is complete
    setTimeout(() => {
      // Double-check optimization state and close state after timeout
      if (this.isOptimizing || this.justClosed) {
        return;
      }
      
      const selection = window.getSelection();
      const selectedText = selection.toString().trim();
      
      if (selectedText.length > 0 && selectedText.length < 500000) {
        // Check if the selection is actually inside an input field
        const isInInputField = this.isSelectionInInputField(selection) ||
                              this.isSelectionInAnyInputElement(selection);
        
        if (!isInInputField) {
          console.log('Instant Prompt Optimizer: Selection not in any input field, ignoring');
          this.hidePopup();
          return;
        }
        
        // Make content validation more permissive - only skip for very obvious empty cases
        if (!this.isInputFieldContentValidGenerous(selection, selectedText)) {
          console.log('Instant Prompt Optimizer: Input field appears to be empty, ignoring');
          this.hidePopup();
          this.clearCachedOptimization();
          return;
        }
        
        // If this is a new selection different from cached one, clear the cache
        if (this.selectedText && this.selectedText !== selectedText) {
          this.clearCachedOptimization();
        }
        
        this.selectedText = selectedText;
        
        // For very long text, use a more robust range selection
        let selectionRange = null;
        try {
          if (selection.rangeCount > 0) {
            selectionRange = selection.getRangeAt(0).cloneRange();
          }
        } catch (error) {
          console.log('Could not get selection range:', error);
        }
        
        this.selectionRange = selectionRange;
        
        // Store additional selection info for input fields
        const activeElement = document.activeElement;
        if (activeElement && (activeElement.tagName === 'TEXTAREA' || activeElement.tagName === 'INPUT')) {
          this.selectionStart = activeElement.selectionStart;
          this.selectionEnd = activeElement.selectionEnd;
          this.targetElement = activeElement;
        } else {
          this.selectionStart = null;
          this.selectionEnd = null;
          this.targetElement = null;
        }
        
        // Also try to find and store the input element from selection for cases where activeElement isn't set
        if (!this.targetElement) {
          this.targetElement = this.findInputElementFromSelection(selection);
        }
        
        console.log(`Instant Prompt Optimizer: Showing popup for ${selectedText.length} characters in input field on ${window.location.hostname}`);
        this.showOptimizationOptions(event);
      } else {
        if (selectedText.length >= 500000) {
          console.log(`Instant Prompt Optimizer: Text too long (${selectedText.length} chars), max is 500,000`);
        } else if (selectedText.length === 0) {
          console.log('Instant Prompt Optimizer: No text selected, clearing any cached optimization');
          this.clearCachedOptimization();
        }
        this.hidePopup();
      }
    }, 10);
  }

  getOptimizeButtonText() {
    const isShortSentence = this.selectedText.length < 100 && this.selectedText.split(/[.!?]+/).length <= 2;
    return isShortSentence ? 'Improve' : 'Optimize';
  }

  getHeaderTitle() {
    return 'Instant Prompt Optimizer';
  }

  showOptimizationOptions(event) {
    // Prevent creating new popups during active optimization
    if (this.isOptimizing) {
      return;
    }
    
    // Check if a popup already exists in the DOM and remove it
    const existingPopup = document.querySelector('.prompt-optimizer-popup');
    if (existingPopup) {
      console.log('Instant Prompt Optimizer: Found existing popup, removing it');
      existingPopup.remove();
    }
    
    this.hidePopup(); // Remove any existing popup
    
    // Get selection rectangle, with fallback for long text
    let rect;
    try {
      if (this.selectionRange) {
        rect = this.selectionRange.getBoundingClientRect();
      } else {
        // Fallback: use current selection or cursor position
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
          rect = selection.getRangeAt(0).getBoundingClientRect();
        } else {
          // Last resort: position near cursor or center of viewport
          rect = {
            top: window.scrollY + window.innerHeight / 3,
            left: window.scrollX + window.innerWidth / 2 - 160,
            bottom: window.scrollY + window.innerHeight / 3 + 20,
            right: window.scrollX + window.innerWidth / 2 + 160,
            width: 320,
            height: 20
          };
        }
      }
    } catch (error) {
      console.log('Error getting selection rect:', error);
      // Fallback positioning
      rect = {
        top: window.scrollY + window.innerHeight / 3,
        left: window.scrollX + window.innerWidth / 2 - 160,
        bottom: window.scrollY + window.innerHeight / 3 + 20,
        right: window.scrollX + window.innerWidth / 2 + 160,
        width: 320,
        height: 20
      };
    }
    
    this.optimizationPopup = document.createElement('div');
    this.optimizationPopup.className = 'prompt-optimizer-popup';
    const chars = this.selectedText.length;
    const charDisplay = chars > 10000 ? `${(chars / 1000).toFixed(0)}K` : chars.toLocaleString();

    // Build popup using DOM methods for safety
    const content = document.createElement('div');
    content.className = 'prompt-optimizer-content';

    // Header
    const header = document.createElement('div');
    header.className = 'prompt-optimizer-header';
    header.id = 'dragHandle';

    const meta = document.createElement('div');
    meta.className = 'prompt-optimizer-meta';

    const title = document.createElement('span');
    title.className = 'prompt-optimizer-title';
    title.textContent = this.getHeaderTitle();

    const charcount = document.createElement('span');
    charcount.className = 'prompt-optimizer-charcount';
    charcount.textContent = `${charDisplay} chars`;

    meta.appendChild(title);
    meta.appendChild(charcount);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'prompt-optimizer-close';
    closeBtn.id = 'closeOptimizer';
    closeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

    header.appendChild(meta);
    header.appendChild(closeBtn);

    // Body
    const body = document.createElement('div');
    body.className = 'prompt-optimizer-body';

    const isMac = /Mac/.test(navigator.userAgent);
    const modKey = isMac ? '⌘' : 'Ctrl';

    const optimizeBtn = document.createElement('button');
    optimizeBtn.id = 'optimizeBtn';
    optimizeBtn.className = 'prompt-optimizer-btn primary';
    optimizeBtn.appendChild(document.createTextNode(this.getOptimizeButtonText()));
    const optimizeHint = document.createElement('span');
    optimizeHint.className = 'po-kbd';
    optimizeHint.textContent = `${modKey} ↵`;
    optimizeBtn.appendChild(optimizeHint);

    const loadingIndicator = document.createElement('div');
    loadingIndicator.id = 'loadingIndicator';
    loadingIndicator.className = 'prompt-optimizer-loading';
    loadingIndicator.style.display = 'none';

    const loader = document.createElement('div');
    loader.className = 'prompt-optimizer-loader';
    const loadingMsg = document.createElement('span');
    loadingMsg.id = 'loadingMessage';
    loadingMsg.textContent = 'Optimizing...';
    loadingIndicator.appendChild(loader);
    loadingIndicator.appendChild(loadingMsg);

    const optimizedText = document.createElement('div');
    optimizedText.id = 'optimizedText';
    optimizedText.className = 'prompt-optimizer-result';
    optimizedText.style.display = 'none';

    const actions = document.createElement('div');
    actions.className = 'prompt-optimizer-actions';

    const replaceBtn = document.createElement('button');
    replaceBtn.id = 'replaceBtn';
    replaceBtn.className = 'prompt-optimizer-btn primary';
    replaceBtn.style.display = 'none';
    replaceBtn.appendChild(document.createTextNode('Replace'));
    const replaceHint = document.createElement('span');
    replaceHint.className = 'po-kbd';
    replaceHint.textContent = '↵';
    replaceBtn.appendChild(replaceHint);

    const copyBtn = document.createElement('button');
    copyBtn.id = 'copyBtn';
    copyBtn.className = 'prompt-optimizer-btn secondary';
    copyBtn.style.display = 'none';
    copyBtn.appendChild(document.createTextNode('Copy'));
    const copyHint = document.createElement('span');
    copyHint.className = 'po-kbd';
    copyHint.textContent = `${modKey} ↵`;
    copyBtn.appendChild(copyHint);

    actions.appendChild(replaceBtn);
    actions.appendChild(copyBtn);

    body.appendChild(optimizeBtn);
    body.appendChild(loadingIndicator);
    body.appendChild(optimizedText);
    body.appendChild(actions);

    if (!this.apiKey) {
      const error = document.createElement('div');
      error.className = 'prompt-optimizer-error';
      error.textContent = 'Set up API key in extension settings';
      body.appendChild(error);
    }

    content.appendChild(header);
    content.appendChild(body);
    this.optimizationPopup.appendChild(content);
    
    // Position the popup intelligently
    this.positionPopup(this.optimizationPopup, rect);
    
    document.body.appendChild(this.optimizationPopup);
    
    // Add event listeners
    document.getElementById('optimizeBtn').addEventListener('click', this.optimizePrompt.bind(this));
    document.getElementById('replaceBtn').addEventListener('click', this.replaceText.bind(this));
    document.getElementById('copyBtn').addEventListener('click', this.copyOptimizedText.bind(this));
    document.getElementById('closeOptimizer').addEventListener('click', this.handleCloseClick.bind(this));
    
    // Add drag functionality
    this.setupDragFunctionality();
    
    // Prevent popup from closing when clicking inside it
    this.optimizationPopup.addEventListener('mousedown', (e) => e.stopPropagation());
    
    // Add window event listeners for responsive repositioning
    this.addRepositioningEventListeners();
    
    // Keyboard shortcuts
    this.popupKeydownHandler = this.handlePopupKeydown.bind(this);
    this.popupKeypressBlocker = (e) => {
      if (!this.optimizationPopup) return;
      const replaceBtn = document.getElementById('replaceBtn');
      const optimizeBtn = document.getElementById('optimizeBtn');
      if (e.key === 'Enter') {
        const isMod = e.metaKey || e.ctrlKey;
        const hasResult = replaceBtn && replaceBtn.style.display !== 'none';
        const hasOptimize = optimizeBtn && optimizeBtn.style.display !== 'none';
        if (hasResult || (isMod && hasOptimize)) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      }
    };
    window.addEventListener('keydown', this.popupKeydownHandler, true);
    window.addEventListener('keypress', this.popupKeypressBlocker, true);
    window.addEventListener('keyup', this.popupKeypressBlocker, true);

    // Check if we have a cached optimization for this text
    this.checkForCachedOptimization();
  }

  async optimizePrompt() {
    // Prevent multiple simultaneous requests
    if (this.isOptimizing) {
      return;
    }

    if (!this.apiKey) {
      alert('Please configure your Gemini API key in the extension popup first.');
      return;
    }

    const loadingIndicator = document.getElementById('loadingIndicator');
    const optimizeBtn = document.getElementById('optimizeBtn');
    const optimizedTextDiv = document.getElementById('optimizedText');
    
    // Set optimizing state to prevent multiple requests
    this.isOptimizing = true;
    
    // Create a unique key for this optimization session
    const sessionKey = `optimization_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Show loading state with appropriate message
    const isLargeText = this.selectedText.length > 10000;
    const isVeryLargeText = this.selectedText.length > 50000;
    const isShortSentence = this.selectedText.length < 100 && this.selectedText.split(/[.!?]+/).length <= 2;
    const loadingMessage = document.getElementById('loadingMessage');
    
    if (isShortSentence) {
      loadingMessage.textContent = 'Improving grammar and clarity...';
    } else if (isVeryLargeText) {
      loadingMessage.textContent = 'Processing large document, this may take up to a minute...';
    } else if (isLargeText) {
      loadingMessage.textContent = 'Structuring for better AI understanding, this may take a moment...';
    } else {
      loadingMessage.textContent = 'Optimizing your text...';
    }
    
    optimizeBtn.style.display = 'none';
    loadingIndicator.style.display = 'flex';
    optimizeBtn.disabled = true;
    
    try {
      const optimizedPrompt = await this.callGeminiAPI(this.selectedText);
      
      // Store optimization result in both memory and persistent storage
      this.optimizedPrompt = optimizedPrompt;
      this.currentSessionKey = sessionKey;
      
      // Save to chrome storage for persistence across tab switches
      const optimizationData = {
        originalText: this.selectedText,
        optimizedText: optimizedPrompt,
        timestamp: Date.now(),
        url: window.location.href,
        sessionKey: sessionKey
      };
      
      await chrome.storage.local.set({
        [sessionKey]: optimizationData,
        currentOptimization: sessionKey
      });
      
      // Display the optimized prompt
      optimizedTextDiv.textContent = optimizedPrompt;
      optimizedTextDiv.style.display = 'block';
      
      // Hide the optimize button and show action buttons
      optimizeBtn.style.display = 'none';
      document.getElementById('replaceBtn').style.display = 'inline-flex';
      document.getElementById('copyBtn').style.display = 'inline-flex';
      
      // Reposition popup after content is added to prevent overflow
      setTimeout(() => {
        this.repositionPopupAfterExpansion();
      }, 50);
      
    } catch (error) {
      console.error('Instant Prompt Optimizer: Error optimizing prompt:', error);
      optimizeBtn.style.display = '';

      let errorMessage = 'Error optimizing prompt. ';
      if (error.message.includes('API_KEY_INVALID')) {
        errorMessage += 'Invalid API key. Please check your Gemini API key.';
      } else if (error.message.includes('QUOTA_EXCEEDED')) {
        errorMessage += 'API quota exceeded. Please check your Gemini API usage.';
      } else {
        errorMessage += 'Please try again.';
      }
      
      alert(errorMessage);
      
      // Reposition popup after error message might be shown
      setTimeout(() => {
        this.repositionPopupAfterExpansion();
      }, 50);
    } finally {
      this.isOptimizing = false;
      loadingIndicator.style.display = 'none';
      optimizeBtn.disabled = false;
    }
  }

  getWebsiteContext() {
    // Extract website domain for context
    const websiteInfo = {
      domain: window.location.hostname
    };
    
    return websiteInfo;
  }

  async callGeminiAPI(text) {
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemma-3-27b-it:generateContent?key=${this.apiKey}`;
    
    // Get website context for dynamic optimization
    const websiteInfo = this.getWebsiteContext();
    
    // Determine optimization approach based on text length and complexity
    const isLargeText = text.length > 10000;
    const isShortSentence = text.length < 100 && text.split(/[.!?]+/).length <= 2;

    let prompt;

    if (isShortSentence) {
      prompt = `Fix grammar and make this sentence smoother. Source: ${websiteInfo.domain}

Keep the same meaning, tone, and formatting style. Match the original punctuation and formatting exactly—if the input uses plain text without markdown, return plain text. If it uses markdown, keep markdown.

Text: "${text}"

Return only the improved version:`;
    } else if (isLargeText) {
      prompt = `Optimize this text for AI understanding. Source: ${websiteInfo.domain}

Fix grammar and make sentences smoother and better structured for AI to understand and follow. Match the original punctuation and formatting exactly—if the input uses plain text without markdown, return plain text. If it uses markdown, keep markdown.

Text: "${text}"

Return only the optimized version:`;
    } else {
      prompt = `Improve this text for grammar and clarity. Source: ${websiteInfo.domain}

Fix grammar, make sentences smoother and more specific while keeping the same intent and tone. Match the original punctuation and formatting exactly—if the input uses plain text without markdown, return plain text. If it uses markdown, keep markdown.

Text: "${text}"

Return only the improved version:`;
    }

    // Adjust parameters based on text length - be generous with Gemini's 1M context window
    const maxTokens = text.length > 50000 ? 8192 : 
                     text.length > 10000 ? 4096 : 
                     text.length > 1000 ? 2048 : 1024;
    
    const requestBody = {
      contents: [
        {
          parts: [
            {
              text: prompt
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.7,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: maxTokens,
        candidateCount: 1
      },
      safetySettings: [
        {
          category: "HARM_CATEGORY_HARASSMENT",
          threshold: "BLOCK_MEDIUM_AND_ABOVE"
        },
        {
          category: "HARM_CATEGORY_HATE_SPEECH", 
          threshold: "BLOCK_MEDIUM_AND_ABOVE"
        },
        {
          category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
          threshold: "BLOCK_MEDIUM_AND_ABOVE"
        },
        {
          category: "HARM_CATEGORY_DANGEROUS_CONTENT",
          threshold: "BLOCK_MEDIUM_AND_ABOVE"
        }
      ]
    };

    // Add timeout for large text processing - be more generous for very large texts
    const timeoutMs = text.length > 100000 ? 120000 : // 2 minutes for very large texts
                     text.length > 50000 ? 90000 :   // 1.5 minutes for large texts
                     text.length > 10000 ? 60000 :   // 1 minute for medium-large texts
                     30000; // 30s for normal texts
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    
    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`API request failed: ${response.status} - ${errorData.error?.message || 'Unknown error'}`);
      }

      const data = await response.json();
      
      if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
        console.error('Gemini API response structure:', JSON.stringify(data, null, 2));
        throw new Error('Invalid response from Gemini API - missing candidates or content');
      }

      if (!data.candidates[0].content.parts || !data.candidates[0].content.parts[0] || !data.candidates[0].content.parts[0].text) {
        console.error('Gemini API response parts structure:', JSON.stringify(data.candidates[0], null, 2));
        throw new Error('Invalid response from Gemini API - missing text in parts');
      }

      return data.candidates[0].content.parts[0].text.trim();
      
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        throw new Error(`Request timeout - large text processing took too long. Try with smaller text or try again later.`);
      }
      throw error;
    }
  }

  replaceText() {
    if (!this.optimizedPrompt) return;
    
    // First try to use the stored target element (important for Google and similar sites)
    let inputField = this.targetElement;
    
    // If stored element is no longer valid, try to find it again
    if (!inputField || !this.isValidInputField(inputField)) {
      console.log('Instant Prompt Optimizer: Stored target element invalid, searching for input field');
      inputField = this.findNearestInputField();
    }
    
    // If still no input field, try more aggressive detection
    if (!inputField) {
      console.log('Instant Prompt Optimizer: Standard search failed, trying aggressive detection');
      inputField = this.findInputFieldAggressively();
    }
    
    if (inputField) {
      console.log('Instant Prompt Optimizer: Found input field:', inputField.tagName, inputField);
      
      // Reactivate the input field before replacement (important for Google)
      this.reactivateInputField(inputField);
      
      // Small delay to ensure field is reactivated
      setTimeout(() => {
        try {
          // Handle different types of input elements
          if (inputField.contentEditable === 'true') {
            console.log('Instant Prompt Optimizer: Replacing in contenteditable element');
            this.replaceInContentEditable(inputField);
          } else if (inputField.tagName === 'TEXTAREA' || inputField.tagName === 'INPUT') {
            console.log('Instant Prompt Optimizer: Replacing in textarea/input element');
            this.replaceInTextInput(inputField);
          } else {
            console.log('Instant Prompt Optimizer: Unknown input type, copying to clipboard');
            this.copyOptimizedText();
            return;
          }
          
          this.hidePopup();
          
          // Clear the stored optimization since text has been replaced
          this.clearStoredOptimization();
        } catch (error) {
          console.error('Instant Prompt Optimizer: Error during replacement:', error);
          this.copyOptimizedText();
        }
      }, 100);
    } else {
      console.log('Instant Prompt Optimizer: No input field found, copying to clipboard');
      this.copyOptimizedText();
    }
  }


  replaceInContentEditable(element) {
    // For contenteditable elements (like Claude.ai)
    const currentText = element.textContent || element.innerText || '';
    
    // Method 1: Try to replace only the selected text within existing content
    if (currentText.includes(this.selectedText)) {
      // Replace only the first occurrence of the selected text
      const newText = currentText.replace(this.selectedText, this.optimizedPrompt);
      element.textContent = newText;
      
      // Calculate cursor position after replacement
      const beforeSelected = currentText.indexOf(this.selectedText);
      const newCursorPos = beforeSelected + this.optimizedPrompt.length;
      
      // Set cursor position after the replaced text
      setTimeout(() => {
        element.focus();
        try {
          const range = document.createRange();
          const sel = window.getSelection();
          
          // Try to set cursor position within the text
          if (element.firstChild && element.firstChild.nodeType === Node.TEXT_NODE) {
            const textNode = element.firstChild;
            const safePos = Math.min(newCursorPos, textNode.textContent.length);
            range.setStart(textNode, safePos);
            range.setEnd(textNode, safePos);
            sel.removeAllRanges();
            sel.addRange(range);
          }
        } catch (e) {
          // Fallback: place cursor at end
          const range = document.createRange();
          const sel = window.getSelection();
          range.selectNodeContents(element);
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }, 10);
    } else {
      // Fallback: If we can't find the exact selected text, try using selection range
      element.focus();
      
      // Try to use the stored selection range if it's still valid
      if (this.selectionRange) {
        try {
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(this.selectionRange);
          document.execCommand('insertText', false, this.optimizedPrompt);
        } catch (e) {
          // Final fallback: replace entire content
          element.textContent = this.optimizedPrompt;
        }
      } else {
        // Final fallback: replace entire content
        element.textContent = this.optimizedPrompt;
      }
    }
    
    // Trigger events for frameworks
    const events = ['input', 'change', 'keyup', 'paste'];
    events.forEach(eventType => {
      element.dispatchEvent(new Event(eventType, { bubbles: true }));
    });
    
    // For React and other frameworks
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set || 
                                   Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (nativeInputValueSetter && element.value !== undefined) {
      nativeInputValueSetter.call(element, element.textContent);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  replaceInTextInput(element) {
    // For textarea and input elements
    const currentValue = element.value || '';
    
    // Method 1: Replace only the selected text within existing content
    let newValue;
    let newCursorPos;
    
    if (currentValue.includes(this.selectedText)) {
      // Replace only the first occurrence of the selected text
      const beforeSelected = currentValue.indexOf(this.selectedText);
      newValue = currentValue.replace(this.selectedText, this.optimizedPrompt);
      newCursorPos = beforeSelected + this.optimizedPrompt.length;
    } else {
      // Fallback: Try to use stored selection info or current selection
      let selectionStart, selectionEnd;
      
      if (this.targetElement === element && this.selectionStart !== null && this.selectionEnd !== null) {
        // Use stored selection info if available and matches current element
        selectionStart = this.selectionStart;
        selectionEnd = this.selectionEnd;
      } else {
        // Use current selection or fallback to replacing entire content
        selectionStart = element.selectionStart || 0;
        selectionEnd = element.selectionEnd || currentValue.length;
      }
      
      // Replace the selected range
      newValue = currentValue.substring(0, selectionStart) + 
                this.optimizedPrompt + 
                currentValue.substring(selectionEnd);
      newCursorPos = selectionStart + this.optimizedPrompt.length;
    }
    
    // Handle Google Search specifically
    if (window.location.hostname.includes('google.com')) {
      this.replaceInGoogleSearchInput(element, newValue, newCursorPos);
      return;
    }
    
    // Standard replacement for other sites
    this.performStandardTextReplacement(element, newValue, newCursorPos);
  }

  findNearestInputField() {
    // Website-specific selectors for better targeting
    const specificSelectors = {
      // Claude.ai
      'claude.ai': [
        'div[contenteditable="true"][data-testid*="chat"]',
        'div[contenteditable="true"]',
        '.ProseMirror'
      ],
      // ChatGPT
      'chatgpt.com': [
        'textarea[data-testid="composer-text-input"]',
        '#prompt-textarea',
        'textarea[placeholder*="Message"]'
      ],
      'chat.openai.com': [
        'textarea[data-testid="composer-text-input"]',
        '#prompt-textarea',
        'textarea[placeholder*="Message"]'
      ],
      // Gemini
      'gemini.google.com': [
        'div[contenteditable="true"]',
        'textarea[aria-label*="Enter a prompt"]'
      ],
      // Perplexity
      'perplexity.ai': [
        'textarea[placeholder*="Ask anything"]',
        'div[contenteditable="true"]'
      ],
      // Google Search
      'google.com': [
        'textarea[name="q"]',
        'input[name="q"]',
        'textarea[aria-label*="Search"]',
        'input[aria-label*="Search"]',
        'textarea[title*="Search"]',
        'input[title*="Search"]',
        '.gLFyf',
        '#APjFqb'
      ]
    };
    
    // Get current domain
    const domain = window.location.hostname;
    const domainKey = Object.keys(specificSelectors).find(key => domain.includes(key));
    
    // Try website-specific selectors first
    if (domainKey) {
      for (const selector of specificSelectors[domainKey]) {
        const elements = document.querySelectorAll(selector);
        for (const element of elements) {
          if (this.isValidInputField(element)) {
            return element;
          }
        }
      }
    }
    
    // Comprehensive fallback selectors - very generous
    const genericSelectors = [
      // Common search and query inputs
      'textarea[name="q"]', 'input[name="q"]',
      'textarea[name*="search"]', 'input[name*="search"]',
      'textarea[name*="query"]', 'input[name*="query"]',
      
      // Placeholder-based detection
      'textarea[placeholder*="search" i]', 'input[placeholder*="search" i]',
      'textarea[placeholder*="message" i]', 'input[placeholder*="message" i]',
      'textarea[placeholder*="question" i]', 'input[placeholder*="question" i]',
      'textarea[placeholder*="ask" i]', 'input[placeholder*="ask" i]',
      'textarea[placeholder*="prompt" i]', 'input[placeholder*="prompt" i]',
      'textarea[placeholder*="chat" i]', 'input[placeholder*="chat" i]',
      'textarea[placeholder*="comment" i]', 'input[placeholder*="comment" i]',
      'textarea[placeholder*="note" i]', 'input[placeholder*="note" i]',
      'textarea[placeholder*="write" i]', 'input[placeholder*="write" i]',
      'textarea[placeholder*="text" i]', 'input[placeholder*="text" i]',
      'textarea[placeholder*="type" i]', 'input[placeholder*="type" i]',
      'textarea[placeholder*="enter" i]', 'input[placeholder*="enter" i]',
      
      // Aria-label based detection
      'textarea[aria-label*="search" i]', 'input[aria-label*="search" i]',
      'textarea[aria-label*="message" i]', 'input[aria-label*="message" i]',
      'textarea[aria-label*="text" i]', 'input[aria-label*="text" i]',
      'textarea[aria-label*="input" i]', 'input[aria-label*="input" i]',
      'textarea[aria-label*="write" i]', 'input[aria-label*="write" i]',
      'textarea[aria-label*="comment" i]', 'input[aria-label*="comment" i]',
      
      // Role-based detection
      '[role="textbox"]', '[role="searchbox"]', '[role="combobox"]',
      
      // Contenteditable elements
      'div[contenteditable="true"]', '[contenteditable="true"]',
      
      // Class-based detection (common patterns)
      '.search-input', '.search-box', '.search-field',
      '.text-input', '.text-box', '.text-field', '.text-area',
      '.message-input', '.message-box', '.message-field',
      '.comment-input', '.comment-box', '.comment-field',
      '.input-field', '.input-box', '.form-control',
      '.textbox', '.textarea', '.searchbox',
      
      // ID-based detection (common patterns)
      '#search', '#search-input', '#search-box', '#search-field',
      '#message', '#message-input', '#message-box',
      '#comment', '#comment-input', '#comment-box',
      '#text', '#text-input', '#text-box', '#textarea',
      '#input', '#inputbox', '#textbox',
      
      // Generic selectors (broad catch-all)
      'textarea[rows]', 'textarea[cols]',
      'textarea', 'input[type="text"]', 'input[type="search"]',
      'input:not([type])', // inputs without explicit type
      'input[type="email"]', 'input[type="url"]', // might contain text to optimize
      
      // Very broad selectors (last resort)
      'input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="image"]):not([type="hidden"])'
    ];
    
    for (const selector of genericSelectors) {
      const elements = document.querySelectorAll(selector);
      for (const element of elements) {
        if (this.isValidInputField(element)) {
          return element;
        }
      }
    }
    
    return null;
  }

  isValidInputField(element) {
    // More generous validation - check if element is visible and usable
    try {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      
      // Basic visibility checks
      if (style.display === 'none' || style.visibility === 'hidden') {
        return false;
      }
      
      // Check if element is disabled or readonly
      if (element.disabled || element.readOnly) {
        return false;
      }
      
      // More generous size requirements
      const isVisible = (
        rect.width > 50 &&  // Reduced from 100
        rect.height > 15 && // Reduced from 20
        rect.width < window.innerWidth + 100 && // Not absurdly wide
        rect.height < window.innerHeight + 100   // Not absurdly tall
      );
      
      // Check if element is in viewport or nearby (for dynamically positioned elements)
      const isInOrNearViewport = (
        rect.top > -100 && rect.top < window.innerHeight + 100 &&
        rect.left > -100 && rect.left < window.innerWidth + 100
      );
      
      // For very small elements, be extra permissive if they have input-like attributes
      if (!isVisible && this.hasInputLikeAttributes(element)) {
        // Small elements might still be valid if they're input-focused
        return rect.width > 10 && rect.height > 10 && isInOrNearViewport;
      }
      
      return isVisible && isInOrNearViewport;
    } catch (error) {
      console.log('Error validating input field:', error);
      return true; // Default to true if we can't validate
    }
  }

  // Check if element has input-like attributes that suggest it's an input field
  hasInputLikeAttributes(element) {
    const inputLikeAttributes = [
      'placeholder', 'aria-label', 'data-testid', 'name', 'id', 'class'
    ];
    
    const inputKeywords = [
      'input', 'search', 'text', 'message', 'comment', 'note', 'write', 
      'edit', 'field', 'box', 'area', 'prompt', 'query', 'ask', 'chat'
    ];
    
    for (const attr of inputLikeAttributes) {
      const value = element.getAttribute(attr);
      if (value) {
        const lowerValue = value.toLowerCase();
        for (const keyword of inputKeywords) {
          if (lowerValue.includes(keyword)) {
            return true;
          }
        }
      }
    }
    
    return false;
  }

  isSelectionInInputField(selection) {
    // Check if the current selection is within an input field
    if (!selection || selection.rangeCount === 0) {
      return false;
    }

    try {
      const range = selection.getRangeAt(0);
      const container = range.commonAncestorContainer;
      
      // Walk up the DOM tree to find if we're inside an input field
      let element = container.nodeType === Node.TEXT_NODE ? container.parentElement : container;
      
      while (element && element !== document.body) {
        // Check for standard input fields
        if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
          return this.isValidInputField(element);
        }
        
        // Check for contenteditable elements
        if (element.contentEditable === 'true') {
          return this.isValidInputField(element);
        }
        
        // Check for specific AI chat platforms' input elements
        if (this.isAIChatInputElement(element)) {
          return true;
        }
        
        element = element.parentElement;
      }
      
      return false;
    } catch (error) {
      console.log('Error checking if selection is in input field:', error);
      return false;
    }
  }

  isAIChatInputElement(element) {
    // Check for specific AI chat platform input patterns
    const chatInputSelectors = [
      // Claude.ai patterns
      '[data-testid*="chat"]',
      '.ProseMirror',
      // ChatGPT patterns  
      '[data-testid="composer-text-input"]',
      '[placeholder*="Message"]',
      // Gemini patterns
      '[aria-label*="Enter a prompt"]',
      // Perplexity patterns
      '[placeholder*="Ask anything"]',
      // Google Search patterns
      '[name="q"]',
      '[aria-label*="Search"]',
      '[title*="Search"]',
      '.gLFyf',
      '#APjFqb',
      // Generic chat patterns
      '[placeholder*="message" i]',
      '[placeholder*="question" i]',
      '[placeholder*="ask" i]',
      '[placeholder*="prompt" i]',
      '[placeholder*="chat" i]',
      '[placeholder*="search" i]'
    ];

    // Check if element matches any chat input patterns
    for (const selector of chatInputSelectors) {
      try {
        if (element.matches && element.matches(selector)) {
          return this.isValidInputField(element);
        }
      } catch (e) {
        // Ignore selector errors
      }
    }

    // Check parent elements for chat input patterns
    let parent = element.parentElement;
    let depth = 0;
    while (parent && depth < 3) { // Only check up to 3 levels up
      for (const selector of chatInputSelectors) {
        try {
          if (parent.matches && parent.matches(selector)) {
            return this.isValidInputField(parent);
          }
        } catch (e) {
          // Ignore selector errors
        }
      }
      parent = parent.parentElement;
      depth++;
    }

    return false;
  }

  isInputFieldContentValid(selection, selectedText) {
    // Check if the input field has meaningful content beyond just the selection
    try {
      const range = selection.getRangeAt(0);
      const container = range.commonAncestorContainer;
      let inputElement = container.nodeType === Node.TEXT_NODE ? container.parentElement : container;
      
      // Walk up to find the actual input element
      while (inputElement && inputElement !== document.body) {
        if (inputElement.tagName === 'TEXTAREA' || inputElement.tagName === 'INPUT') {
          const totalContent = inputElement.value || '';
          
          // If the field is completely empty, don't show popup
          if (totalContent.trim().length === 0) {
            return false;
          }
          
          // If the field only contains the selected text and nothing else, 
          // and the selected text is very short, it might be a deletion case
          if (totalContent.trim() === selectedText.trim() && selectedText.length < 10) {
            return false;
          }
          
          return true;
        }
        
        if (inputElement.contentEditable === 'true') {
          const totalContent = inputElement.textContent || inputElement.innerText || '';
          
          // If the field is completely empty, don't show popup
          if (totalContent.trim().length === 0) {
            return false;
          }
          
          // If the field only contains the selected text and nothing else,
          // and the selected text is very short, it might be a deletion case
          if (totalContent.trim() === selectedText.trim() && selectedText.length < 10) {
            return false;
          }
          
          return true;
        }
        
        inputElement = inputElement.parentElement;
      }
      
      // If we can't find a proper input element, allow the selection
      return true;
    } catch (error) {
      console.log('Error validating input field content:', error);
      return true; // Default to allowing the selection if we can't validate
    }
  }

  // New generous content validation - much more permissive
  isInputFieldContentValidGenerous(selection, selectedText) {
    // Only reject in very obvious empty cases
    try {
      // If selected text is reasonable length, allow it
      if (selectedText.length >= 3) {
        return true;
      }
      
      // For very short selections, do basic validation
      const range = selection.getRangeAt(0);
      const container = range.commonAncestorContainer;
      let inputElement = container.nodeType === Node.TEXT_NODE ? container.parentElement : container;
      
      // Walk up to find the actual input element
      while (inputElement && inputElement !== document.body) {
        if (inputElement.tagName === 'TEXTAREA' || inputElement.tagName === 'INPUT') {
          const totalContent = inputElement.value || '';
          // Only reject if completely empty
          return totalContent.trim().length > 0;
        }
        
        if (inputElement.contentEditable === 'true') {
          const totalContent = inputElement.textContent || inputElement.innerText || '';
          // Only reject if completely empty
          return totalContent.trim().length > 0;
        }
        
        inputElement = inputElement.parentElement;
      }
      
      // If we can't find input element, allow the selection
      return true;
    } catch (error) {
      console.log('Error in generous content validation:', error);
      return true; // Default to allowing the selection
    }
  }

  // Check if selection is in any input element with generous detection
  isSelectionInAnyInputElement(selection) {
    try {
      const range = selection.getRangeAt(0);
      const container = range.commonAncestorContainer;
      let element = container.nodeType === Node.TEXT_NODE ? container.parentElement : container;
      
      // Walk up the DOM tree with generous matching
      while (element && element !== document.body && element !== document.documentElement) {
        // Check for any input-like element
        if (this.isAnyKindOfInputElement(element)) {
          return true;
        }
        element = element.parentElement;
      }
      
      return false;
    } catch (error) {
      console.log('Error in generous selection validation:', error);
      return false;
    }
  }

  // Check if there's any active input element on the page
  hasActiveInputElement() {
    const activeElement = document.activeElement;
    if (activeElement && this.isAnyKindOfInputElement(activeElement)) {
      return true;
    }
    
    // Also check for any focused input elements
    const focusedInputs = document.querySelectorAll('input:focus, textarea:focus, [contenteditable="true"]:focus');
    return focusedInputs.length > 0;
  }

  // Very generous check for any kind of input element
  isAnyKindOfInputElement(element) {
    if (!element || !element.tagName) return false;
    
    const tagName = element.tagName.toUpperCase();
    
    // Standard input elements
    if (tagName === 'INPUT' || tagName === 'TEXTAREA') {
      return this.isValidInputField(element);
    }
    
    // Contenteditable elements
    if (element.contentEditable === 'true') {
      return this.isValidInputField(element);
    }
    
    // Elements with input-like roles
    const role = element.getAttribute('role');
    if (role && ['textbox', 'searchbox', 'combobox'].includes(role.toLowerCase())) {
      return this.isValidInputField(element);
    }
    
    // Elements with input-like classes or IDs (common patterns)
    const classAndId = (element.className + ' ' + (element.id || '')).toLowerCase();
    const inputPatterns = [
      'input', 'search', 'text', 'message', 'comment', 'note', 'write', 'edit',
      'field', 'box', 'area', 'prompt', 'query', 'ask', 'chat', 'compose'
    ];
    
    for (const pattern of inputPatterns) {
      if (classAndId.includes(pattern)) {
        return this.isValidInputField(element);
      }
    }
    
    // Check for common input attributes
    const inputAttributes = ['placeholder', 'data-testid', 'aria-label', 'name', 'title'];
    for (const attr of inputAttributes) {
      const value = element.getAttribute(attr);
      if (value) {
        const lowerValue = value.toLowerCase();
        for (const pattern of inputPatterns) {
          if (lowerValue.includes(pattern)) {
            return this.isValidInputField(element);
          }
        }
      }
    }
    
    return false;
  }

  // Find input element from selection range
  findInputElementFromSelection(selection) {
    try {
      if (!selection || selection.rangeCount === 0) {
        return null;
      }
      
      const range = selection.getRangeAt(0);
      const container = range.commonAncestorContainer;
      let element = container.nodeType === Node.TEXT_NODE ? container.parentElement : container;
      
      // Walk up the DOM tree to find an input element
      while (element && element !== document.body) {
        if (this.isAnyKindOfInputElement(element)) {
          return element;
        }
        element = element.parentElement;
      }
      
      return null;
    } catch (error) {
      console.log('Error finding input element from selection:', error);
      return null;
    }
  }

  // Reactivate input field (important for Google and similar sites)
  reactivateInputField(inputField) {
    try {
      console.log('Instant Prompt Optimizer: Reactivating input field');
      
      // Force focus on the element
      inputField.focus();
      
      // Trigger mouse and focus events to reactivate
      const events = [
        { type: 'mousedown', event: MouseEvent },
        { type: 'mouseup', event: MouseEvent },
        { type: 'click', event: MouseEvent },
        { type: 'focus', event: FocusEvent },
        { type: 'focusin', event: FocusEvent }
      ];
      
      events.forEach(({ type, event }) => {
        try {
          const evt = new event(type, {
            bubbles: true,
            cancelable: true,
            view: window
          });
          inputField.dispatchEvent(evt);
        } catch (e) {
          // Fallback to basic Event if specific event type fails
          try {
            const evt = new Event(type, { bubbles: true });
            inputField.dispatchEvent(evt);
          } catch (e2) {
            // Ignore if we can't create the event
          }
        }
      });
      
      // For Google specifically, trigger additional activation
      if (window.location.hostname.includes('google.com')) {
        this.reactivateGoogleSearchField(inputField);
      }
      
    } catch (error) {
      console.log('Error reactivating input field:', error);
    }
  }

  // Google-specific field reactivation
  reactivateGoogleSearchField(inputField) {
    try {
      // Google often uses pointer events
      const pointerEvents = ['pointerdown', 'pointerup', 'touchstart', 'touchend'];
      pointerEvents.forEach(eventType => {
        try {
          const event = new Event(eventType, { bubbles: true });
          inputField.dispatchEvent(event);
        } catch (e) {
          // Ignore event creation errors
        }
      });
      
      // Clear any readonly state temporarily
      const wasReadOnly = inputField.readOnly;
      inputField.readOnly = false;
      
      // Restore readonly state after a delay if it was set
      if (wasReadOnly) {
        setTimeout(() => {
          inputField.readOnly = wasReadOnly;
        }, 1000);
      }
      
      // Trigger Google-specific events that might be needed
      const googleEvents = ['input', 'textInput', 'compositionstart', 'compositionend'];
      googleEvents.forEach(eventType => {
        try {
          const event = new Event(eventType, { bubbles: true });
          inputField.dispatchEvent(event);
        } catch (e) {
          // Ignore event creation errors
        }
      });
      
    } catch (error) {
      console.log('Error in Google-specific reactivation:', error);
    }
  }

  // Aggressive input field detection for when standard methods fail
  findInputFieldAggressively() {
    // First try recent elements that might have lost focus
    const recentInputs = document.querySelectorAll('input:not([type="hidden"]):not([type="button"]):not([type="submit"]), textarea, [contenteditable="true"]');
    
    // Sort by how recently they might have been active (heuristic)
    const candidates = Array.from(recentInputs).filter(el => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      
      return (
        rect.width > 10 && 
        rect.height > 10 && 
        style.display !== 'none' && 
        style.visibility !== 'hidden' &&
        !el.disabled
      );
    });
    
    // For Google, prioritize search-related elements
    if (window.location.hostname.includes('google.com')) {
      const googleCandidates = candidates.filter(el => {
        const name = el.getAttribute('name') || '';
        const className = el.className || '';
        const id = el.id || '';
        const placeholder = el.getAttribute('placeholder') || '';
        const ariaLabel = el.getAttribute('aria-label') || '';
        
        const searchPatterns = ['q', 'search', 'query', 'gLFyf', 'APjFqb'];
        const allText = (name + className + id + placeholder + ariaLabel).toLowerCase();
        
        return searchPatterns.some(pattern => allText.includes(pattern.toLowerCase()));
      });
      
      if (googleCandidates.length > 0) {
        return googleCandidates[0];
      }
    }
    
    // Return the first viable candidate
    return candidates.length > 0 ? candidates[0] : null;
  }

  // Google-specific text input replacement
  replaceInGoogleSearchInput(element, newValue, newCursorPos) {
    try {
      console.log('Instant Prompt Optimizer: Using Google-specific replacement');
      
      // Method 1: Clear and set approach (works better with Google's JS framework)
      element.focus();
      
      // Clear existing content first
      element.value = '';
      element.dispatchEvent(new Event('input', { bubbles: true }));
      
      // Small delay to ensure clearing is processed by Google's JS
      setTimeout(() => {
        // Set new value
        element.value = newValue;
        
        // Use native setter for framework compatibility
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          element.constructor.prototype, 'value'
        )?.set;
        
        if (nativeInputValueSetter) {
          nativeInputValueSetter.call(element, newValue);
        }
        
        // Set cursor position
        if (element.setSelectionRange && newCursorPos !== undefined) {
          element.setSelectionRange(newCursorPos, newCursorPos);
        }
        
        // Trigger Google-specific events
        const googleEvents = [
          'input', 'change', 'keyup', 'paste', 'focus',
          'textInput', 'compositionend', 'keydown'
        ];
        
        googleEvents.forEach(eventType => {
          try {
            const event = new Event(eventType, { bubbles: true, cancelable: true });
            element.dispatchEvent(event);
          } catch (e) {
            // Ignore event creation errors
          }
        });
        
        // Additional verification - ensure value is set
        setTimeout(() => {
          if (element.value !== newValue) {
            element.value = newValue;
            element.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }, 100);
        
      }, 50);
      
    } catch (error) {
      console.error('Error in Google-specific replacement:', error);
      // Fallback to standard replacement
      this.performStandardTextReplacement(element, newValue, newCursorPos);
    }
  }

  // Standard text replacement for non-Google sites
  performStandardTextReplacement(element, newValue, newCursorPos) {
    try {
      // Set the new value
      element.value = newValue;
      
      // For React and modern frameworks - use native setter
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        element.constructor.prototype, 'value'
      )?.set;
      
      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(element, newValue);
      }
      
      // Focus and set cursor position after the replaced text
      element.focus();
      
      // Set cursor position after the replacement
      if (element.setSelectionRange && newCursorPos !== undefined) {
        element.setSelectionRange(newCursorPos, newCursorPos);
      }
      
      // Trigger comprehensive events
      const events = [
        'input',
        'change', 
        'keyup',
        'paste'
      ];
      
      events.forEach(eventType => {
        element.dispatchEvent(new Event(eventType, { bubbles: true }));
      });
      
      // Additional compatibility check
      setTimeout(() => {
        if (element.value !== newValue) {
          element.value = newValue;
          element.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }, 50);
    } catch (error) {
      console.error('Error in standard text replacement:', error);
    }
  }

  copyOptimizedText() {
    if (!this.optimizedPrompt) return;
    
    navigator.clipboard.writeText(this.optimizedPrompt).then(() => {
      // Text copied successfully - no visual feedback needed
    }).catch(err => {
      console.error('Failed to copy text: ', err);
    });
  }

  handlePopupKeydown(event) {
    if (!this.optimizationPopup || this.isOptimizing) return;

    const isMod = event.metaKey || event.ctrlKey;

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.handleCloseClick();
      return;
    }

    if (event.key === 'Enter' && isMod) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const optimizeBtn = document.getElementById('optimizeBtn');
      if (optimizeBtn && optimizeBtn.style.display !== 'none') {
        this.optimizePrompt();
      } else {
        this.copyOptimizedText();
      }
      return;
    }

    if (event.key === 'Enter' && !isMod) {
      const replaceBtn = document.getElementById('replaceBtn');
      if (replaceBtn && replaceBtn.style.display !== 'none') {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.replaceText();
      }
    }
  }

  handleCloseClick() {
    if (this.isOptimizing) {
      // Show a message that operation is in progress
      const closeBtn = document.getElementById('closeOptimizer');
      const originalTitle = closeBtn.title;
      closeBtn.title = 'Please wait, optimizing in progress...';
      closeBtn.style.opacity = '0.5';
      closeBtn.style.cursor = 'not-allowed';
      
      setTimeout(() => {
        if (closeBtn) {
          closeBtn.title = originalTitle;
          closeBtn.style.opacity = '';
          closeBtn.style.cursor = '';
        }
      }, 2000);
      return;
    }
    
    // Clear selection to prevent reopening
    this.clearSelection();
    this.hidePopup();
  }

  hidePopup() {
    // Prevent popup closure during optimizing
    if (this.isOptimizing) {
      return;
    }
    
    // Remove all existing popups from DOM to prevent duplicates
    const existingPopups = document.querySelectorAll('.prompt-optimizer-popup');
    existingPopups.forEach(popup => {
      popup.remove();
    });
    
    if (this.optimizationPopup) {
      // Clean up event listeners
      this.removeRepositioningEventListeners();
      if (this.popupKeydownHandler) {
        window.removeEventListener('keydown', this.popupKeydownHandler, true);
        this.popupKeydownHandler = null;
      }
      if (this.popupKeypressBlocker) {
        window.removeEventListener('keypress', this.popupKeypressBlocker, true);
        window.removeEventListener('keyup', this.popupKeypressBlocker, true);
        this.popupKeypressBlocker = null;
      }
      this.optimizationPopup = null;
    }
    
    // Set flag to prevent immediate reopening
    this.justClosed = true;
    setTimeout(() => {
      this.justClosed = false;
    }, 500); // 500ms cooldown period
  }

  handleMouseDown(event) {
    // Check if clicking outside the popup
    if (this.optimizationPopup && !this.optimizationPopup.contains(event.target)) {
      this.clearSelection();
      this.hidePopup();
    }
  }

  handleInputChange(event) {
    // Dismiss popup when the input field content becomes empty (e.g. select all + delete)
    if (!this.optimizationPopup || this.isOptimizing) return;

    const target = event.target;
    if (!target) return;

    let content = '';
    if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') {
      content = target.value || '';
    } else if (target.contentEditable === 'true') {
      content = target.textContent || '';
    } else {
      return;
    }

    if (content.trim().length === 0) {
      this.hidePopup();
      this.clearCachedOptimization();
    }
  }

  positionPopup(popup, selectionRect) {
    // Get viewport dimensions
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const scrollY = window.scrollY;
    const scrollX = window.scrollX;
    
    // Handle invalid or off-screen selection rectangles
    if (!selectionRect || 
        selectionRect.width === 0 && selectionRect.height === 0 ||
        selectionRect.top < scrollY - 100 || 
        selectionRect.top > scrollY + viewportHeight + 100 ||
        selectionRect.left < scrollX - 100 || 
        selectionRect.left > scrollX + viewportWidth + 100) {
      
      // Use center-screen positioning for problematic selections
      selectionRect = {
        top: scrollY + viewportHeight / 3,
        left: scrollX + viewportWidth / 2 - 160,
        bottom: scrollY + viewportHeight / 3 + 20,
        right: scrollX + viewportWidth / 2 + 160,
        width: 320,
        height: 20
      };
    }
    
    // Calculate popup dimensions (we need to temporarily append it to measure)
    popup.style.position = 'absolute';
    popup.style.visibility = 'hidden';
    popup.style.top = '0px';
    popup.style.left = '0px';
    popup.style.zIndex = '10000';
    document.body.appendChild(popup);
    
    const popupRect = popup.getBoundingClientRect();
    const popupHeight = popupRect.height;
    const popupWidth = popupRect.width;
    
    // Remove from DOM temporarily
    document.body.removeChild(popup);
    popup.style.visibility = 'visible';
    
    // Calculate available space above and below the selection
    const spaceAbove = selectionRect.top;
    const spaceBelow = viewportHeight - selectionRect.bottom;
    
    // Calculate available space left and right
    const spaceLeft = selectionRect.left;
    const spaceRight = viewportWidth - selectionRect.right;
    
    // Determine vertical position
    let top;
    let preferredVerticalPosition = 'below'; // default preference
    
    // Check if popup fits below the selection
    if (spaceBelow >= popupHeight + 10) {
      // Enough space below
      top = selectionRect.bottom + scrollY + 10;
      preferredVerticalPosition = 'below';
    } else if (spaceAbove >= popupHeight + 10) {
      // Not enough space below, but enough space above
      top = selectionRect.top + scrollY - popupHeight - 10;
      preferredVerticalPosition = 'above';
    } else {
      // Not enough space in either direction, choose the larger space
      if (spaceAbove > spaceBelow) {
        // More space above
        top = Math.max(scrollY + 10, selectionRect.top + scrollY - popupHeight - 10);
        preferredVerticalPosition = 'above';
      } else {
        // More space below or equal
        top = selectionRect.bottom + scrollY + 10;
        preferredVerticalPosition = 'below';
      }
    }
    
    // Determine horizontal position
    let left = selectionRect.left + scrollX;
    
    // Check if popup fits horizontally
    if (left + popupWidth > viewportWidth + scrollX) {
      // Popup would overflow right side, try to align right edge
      left = selectionRect.right + scrollX - popupWidth;
      
      // If it still overflows left side, align to left edge of viewport
      if (left < scrollX) {
        left = scrollX + 10;
      }
    }
    
    // Ensure popup doesn't overflow left side
    if (left < scrollX) {
      left = scrollX + 10;
    }
    
    // Ensure popup doesn't overflow top or bottom of viewport
    if (top < scrollY) {
      top = scrollY + 10;
    } else if (top + popupHeight > scrollY + viewportHeight) {
      top = scrollY + viewportHeight - popupHeight - 10;
    }
    
    // Apply positioning
    popup.style.position = 'absolute';
    popup.style.top = `${top}px`;
    popup.style.left = `${left}px`;
    popup.style.zIndex = '10000';
    
    // Add a class to indicate position for potential styling
    popup.classList.add(`positioned-${preferredVerticalPosition}`);
    
    // Store positioning info for later repositioning
    popup._positionInfo = {
      selectionRect,
      preferredVerticalPosition,
      originalTop: top,
      originalLeft: left
    };
  }

  repositionPopupAfterExpansion() {
    if (!this.optimizationPopup || !this.optimizationPopup._positionInfo) {
      return;
    }

    const popup = this.optimizationPopup;
    const { selectionRect, preferredVerticalPosition } = popup._positionInfo;
    
    // Get viewport dimensions
    const viewportHeight = window.innerHeight;
    const scrollY = window.scrollY;
    
    // Get current popup dimensions (now with expanded content)
    const popupRect = popup.getBoundingClientRect();
    const popupHeight = popupRect.height;
    
    let newTop = parseInt(popup.style.top);
    let repositioned = false;
    let newPosition = preferredVerticalPosition;
    
    // Calculate available space above and below selection
    const spaceAbove = selectionRect.top - scrollY;
    const spaceBelow = (scrollY + viewportHeight) - selectionRect.bottom;
    
    // Check if popup now overflows the bottom of the viewport
    if (newTop + popupHeight > scrollY + viewportHeight - 10) {
      if (preferredVerticalPosition === 'below') {
        // Currently positioned below, check if we should flip to above
        if (spaceAbove >= popupHeight + 20 && spaceAbove > spaceBelow) {
          // Flip to above - there's more space there
          newTop = selectionRect.top + scrollY - popupHeight - 10;
          newPosition = 'above';
          repositioned = true;
          
          // Update visual indicator
          popup.classList.remove('positioned-below');
          popup.classList.add('positioned-above');
        } else {
          // Not enough space above either, just shift up to fit in viewport
          newTop = scrollY + viewportHeight - popupHeight - 10;
          repositioned = true;
        }
      } else {
        // Already positioned above but still overflowing, shift up more
        newTop = Math.max(scrollY + 10, scrollY + viewportHeight - popupHeight - 10);
        repositioned = true;
      }
    }
    
    // Check if popup overflows the top of viewport (when positioned above)
    if (newTop < scrollY + 10) {
      if (preferredVerticalPosition === 'above' || newPosition === 'above') {
        // Try to flip to below if there's more space there
        if (spaceBelow >= popupHeight + 20 && spaceBelow > spaceAbove) {
          newTop = selectionRect.bottom + scrollY + 10;
          newPosition = 'below';
          repositioned = true;
          
          // Update visual indicator
          popup.classList.remove('positioned-above');
          popup.classList.add('positioned-below');
        } else {
          // Keep above but adjust to minimum top position
          newTop = scrollY + 10;
          repositioned = true;
        }
      } else {
        newTop = scrollY + 10;
        repositioned = true;
      }
    }
    
    // Apply new position with smooth transition
    if (repositioned) {
      popup.style.transition = 'top 0.3s ease-out';
      popup.style.top = `${newTop}px`;
      
      // Update stored position info
      popup._positionInfo.preferredVerticalPosition = newPosition;
      
      // Remove transition after animation completes
      setTimeout(() => {
        if (popup && popup.style) {
          popup.style.transition = '';
        }
      }, 300);
    }
  }

  addRepositioningEventListeners() {
    // Throttle function to limit how often repositioning occurs
    let repositionTimeout;
    const throttledReposition = () => {
      clearTimeout(repositionTimeout);
      repositionTimeout = setTimeout(() => {
        this.repositionPopupAfterExpansion();
      }, 100);
    };

    // Handle window resize
    this.resizeHandler = throttledReposition;
    window.addEventListener('resize', this.resizeHandler);

    // Handle scroll (with more aggressive throttling)
    let scrollTimeout;
    this.scrollHandler = () => {
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        this.repositionPopupAfterExpansion();
      }, 50);
    };
    window.addEventListener('scroll', this.scrollHandler, { passive: true });
  }

  removeRepositioningEventListeners() {
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
      this.resizeHandler = null;
    }
    if (this.scrollHandler) {
      window.removeEventListener('scroll', this.scrollHandler);
      this.scrollHandler = null;
    }
  }

  clearSelection() {
    // Clear text selection to prevent popup from reopening
    try {
      const selection = window.getSelection();
      if (selection.rangeCount > 0) {
        selection.removeAllRanges();
      }
    } catch (e) {
      // Ignore errors if selection clearing fails
    }
  }

  async restoreOptimizationState() {
    try {
      // Check if there's a current optimization for this page
      const result = await chrome.storage.local.get(['currentOptimization']);
      
      if (!result.currentOptimization) {
        return;
      }
      
      // Get the optimization data
      const optimizationResult = await chrome.storage.local.get([result.currentOptimization]);
      const optimizationData = optimizationResult[result.currentOptimization];
      
      if (!optimizationData) {
        return;
      }
      
      // Check if the optimization is for the current page and is recent (within 1 hour)
      const isCurrentPage = optimizationData.url === window.location.href;
      const isRecent = (Date.now() - optimizationData.timestamp) < 3600000; // 1 hour
      
      if (isCurrentPage && isRecent) {
        // Restore the optimization state
        this.optimizedPrompt = optimizationData.optimizedText;
        this.selectedText = optimizationData.originalText;
        this.currentSessionKey = optimizationData.sessionKey;
        
        console.log('Instant Prompt Optimizer: Restored optimization state for current page');
      }
    } catch (error) {
      console.log('Instant Prompt Optimizer: Could not restore optimization state:', error);
    }
  }

  async cleanupOldOptimizations() {
    try {
      // Get all stored optimization data
      const allData = await chrome.storage.local.get(null);
      const keysToRemove = [];
      const oneHourAgo = Date.now() - 3600000; // 1 hour
      
      for (const [key, value] of Object.entries(allData)) {
        // Check if this is an optimization key and if it's old
        if (key.startsWith('optimization_') && value.timestamp && value.timestamp < oneHourAgo) {
          keysToRemove.push(key);
        }
      }
      
      // Remove old optimization data
      if (keysToRemove.length > 0) {
        await chrome.storage.local.remove(keysToRemove);
        console.log(`Instant Prompt Optimizer: Cleaned up ${keysToRemove.length} old optimization(s)`);
      }
    } catch (error) {
      console.log('Instant Prompt Optimizer: Could not cleanup old optimizations:', error);
    }
  }

  async checkForCachedOptimization() {
    try {
      // Check if we have a cached optimization and if it matches the currently selected text
      if (this.optimizedPrompt && this.selectedText) {
        // Compare the cached original text with the currently selected text
        const currentSelection = window.getSelection().toString().trim();
        
        // Only show cached result if it exactly matches the current selection
        if (currentSelection === this.selectedText) {
          // We have a matching cached optimization, show it
          const optimizedTextDiv = document.getElementById('optimizedText');
          const optimizeBtn = document.getElementById('optimizeBtn');
          
          if (optimizedTextDiv && optimizeBtn) {
            // Display the cached optimization
            optimizedTextDiv.textContent = this.optimizedPrompt;
            optimizedTextDiv.style.display = 'block';
            
            // Hide the optimize button and show action buttons
            optimizeBtn.style.display = 'none';
            document.getElementById('replaceBtn').style.display = 'inline-flex';
            document.getElementById('copyBtn').style.display = 'inline-flex';
            
            // Reposition popup after content is added
            setTimeout(() => {
              this.repositionPopupAfterExpansion();
            }, 50);
            
            console.log('Instant Prompt Optimizer: Restored cached optimization result for matching text');
          }
        } else {
          // Current selection doesn't match cached text, clear the cache
          console.log('Instant Prompt Optimizer: Current selection differs from cached text, clearing cache');
          this.clearCachedOptimization();
        }
      }
    } catch (error) {
      console.log('Instant Prompt Optimizer: Error checking cached optimization:', error);
    }
  }

  async clearStoredOptimization() {
    try {
      if (this.currentSessionKey) {
        // Remove the specific optimization data
        await chrome.storage.local.remove([this.currentSessionKey, 'currentOptimization']);
        
        // Clear the local state
        this.optimizedPrompt = null;
        this.currentSessionKey = null;
        
        console.log('Instant Prompt Optimizer: Cleared stored optimization');
      }
    } catch (error) {
      console.log('Instant Prompt Optimizer: Error clearing stored optimization:', error);
    }
  }

  clearCachedOptimization() {
    // Clear only the local cached state, but keep stored data for potential restoration
    this.optimizedPrompt = null;
    this.selectedText = null;
    this.currentSessionKey = null;
    console.log('Instant Prompt Optimizer: Cleared local cached optimization');
  }

  setupDragFunctionality() {
    const dragHandle = document.getElementById('dragHandle');
    if (!dragHandle) return;

    let isDragging = false;
    let dragOffset = { x: 0, y: 0 };

    const handleMouseDown = (e) => {
      // Only start drag if clicking on the header area, not the close button
      if (e.target.closest('.prompt-optimizer-close')) {
        return;
      }

      isDragging = true;
      const rect = this.optimizationPopup.getBoundingClientRect();
      dragOffset.x = e.clientX - rect.left;
      dragOffset.y = e.clientY - rect.top;

      // Add visual feedback
      dragHandle.style.cursor = 'grabbing';
      this.optimizationPopup.style.opacity = '0.9';
      this.optimizationPopup.style.transform = 'scale(1.02)';
      this.optimizationPopup.style.transition = 'none';

      // Prevent text selection while dragging
      e.preventDefault();
      document.body.style.userSelect = 'none';

      // Add global mouse event listeners
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    };

    const handleMouseMove = (e) => {
      if (!isDragging) return;

      const newX = e.clientX - dragOffset.x;
      const newY = e.clientY - dragOffset.y;

      // Constrain to viewport bounds
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const popupRect = this.optimizationPopup.getBoundingClientRect();

      const constrainedX = Math.max(0, Math.min(newX, viewportWidth - popupRect.width));
      const constrainedY = Math.max(0, Math.min(newY, viewportHeight - popupRect.height));

      this.optimizationPopup.style.left = `${constrainedX + window.scrollX}px`;
      this.optimizationPopup.style.top = `${constrainedY + window.scrollY}px`;
    };

    const handleMouseUp = () => {
      if (!isDragging) return;

      isDragging = false;

      // Remove visual feedback
      dragHandle.style.cursor = 'grab';
      this.optimizationPopup.style.opacity = '';
      this.optimizationPopup.style.transform = '';
      this.optimizationPopup.style.transition = '';

      // Restore text selection
      document.body.style.userSelect = '';

      // Remove global mouse event listeners
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    // Set initial cursor style
    dragHandle.style.cursor = 'grab';

    // Add mouse down listener to start dragging
    dragHandle.addEventListener('mousedown', handleMouseDown);
  }
}

// Initialize the prompt optimizer when the page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    if (!window.promptOptimizerInstance) {
      console.log(`Instant Prompt Optimizer: Initializing on DOMContentLoaded for ${window.location.hostname}`);
      window.promptOptimizerInstance = new PromptOptimizer();
      window.promptOptimizerInjected = true;
    } else {
      console.log(`Instant Prompt Optimizer: Instance already exists on ${window.location.hostname}, skipping initialization`);
    }
  });
} else {
  if (!window.promptOptimizerInstance) {
    console.log(`Instant Prompt Optimizer: Initializing immediately for ${window.location.hostname}`);
    window.promptOptimizerInstance = new PromptOptimizer();
    window.promptOptimizerInjected = true;
  } else {
    console.log(`Instant Prompt Optimizer: Instance already exists on ${window.location.hostname}, skipping initialization`);
  }
}