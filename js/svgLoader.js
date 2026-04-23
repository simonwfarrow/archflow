/* =============================================================================
   ArchFlow — js/svgLoader.js
   SVG file loading, sanitisation, and DOM injection.
   Attaches App.loadSVG. Wires all file-input elements on DOMContentLoaded.
   ============================================================================= */

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // File reading
  // ---------------------------------------------------------------------------

  /**
   * Reads a File object and resolves with its text content.
   * @param  {File}            file
   * @return {Promise<string>}
   */
  function readFileAsText(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload  = function (e) { resolve(e.target.result); };
      reader.onerror = function ()  {
        reject(new Error('readFileAsText: failed to read "' + file.name + '"'));
      };
      reader.readAsText(file);
    });
  }

  // ---------------------------------------------------------------------------
  // Sanitisation
  // ---------------------------------------------------------------------------

  /**
   * Strips <script> tags from raw SVG text to prevent XSS.
   * @param  {string} svgText  Raw SVG markup
   * @return {string}          Cleaned SVG markup
   */
  function sanitiseSVGText(svgText) {
    return svgText
      // Remove script elements entirely
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      // Strip inline event handlers (onclick, onload, onmouseover, etc.)
      .replace(/\s+on[a-zA-Z]+\s*=\s*(?:"[^"]*"|'[^']*')/g, '')
      // Neutralise javascript: hrefs
      .replace(/href\s*=\s*["']javascript:[^"']*["']/gi, 'href="#"')
      // Remove xlink:href with data: or javascript: URIs
      .replace(/xlink:href\s*=\s*["'](?:javascript:|data:)[^"']*["']/gi, '');
  }

  // ---------------------------------------------------------------------------
  // Injection
  // ---------------------------------------------------------------------------

  /**
   * Parses SVG text, validates it, then injects it into #svg-host.
   * @param  {string}     svgText  Sanitised SVG markup
   * @return {SVGSVGElement}       The live element appended to #svg-host
   */
  function injectSVGIntoHost(svgText) {
    const svgHost = document.getElementById('svg-host');
    if (!svgHost) {
      throw new Error('injectSVGIntoHost: #svg-host element not found in DOM');
    }

    const parser     = new DOMParser();
    const parsedDoc  = parser.parseFromString(svgText, 'image/svg+xml');

    // DOMParser surfaces XML errors as a <parsererror> element
    const parseError = parsedDoc.querySelector('parsererror');
    if (parseError) {
      throw new Error(
        'injectSVGIntoHost: SVG parse error — ' +
        parseError.textContent.trim().slice(0, 140)
      );
    }

    const parsedSVGElement = parsedDoc.querySelector('svg');
    if (!parsedSVGElement) {
      throw new Error('Invalid SVG: no root svg element found');
    }

    // Import into the main document (creates an adopted copy, not an alias)
    const importedSVGElement = document.importNode(parsedSVGElement, true);

    // Ensure the SVG has at least a viewBox so it can scale predictably;
    // if neither viewBox nor explicit width+height exist, add fallback sizing.
    const hasViewBox       = importedSVGElement.hasAttribute('viewBox');
    const hasWidthAndHeight =
      importedSVGElement.hasAttribute('width') &&
      importedSVGElement.hasAttribute('height');

    if (!hasViewBox && !hasWidthAndHeight) {
      importedSVGElement.setAttribute('width',  '100%');
      importedSVGElement.setAttribute('height', '100%');
    }

    // Inline styles guarantee responsive scaling regardless of SVG attributes
    importedSVGElement.style.maxWidth  = '100%';
    importedSVGElement.style.maxHeight = '100%';
    importedSVGElement.style.width     = 'auto';
    importedSVGElement.style.height    = 'auto';
    importedSVGElement.style.display   = 'block';

    svgHost.innerHTML = '';
    svgHost.appendChild(importedSVGElement);

    return importedSVGElement;
  }

  // ---------------------------------------------------------------------------
  // Main load function (async — returns Promise<SVGSVGElement>)
  // ---------------------------------------------------------------------------

  /**
   * Loads an SVG File, sanitises, injects, then notifies the App.
   * @param  {File}                  file
   * @return {Promise<SVGSVGElement>}
   */
  async function loadSVG(file) {
    if (!file) {
      throw new Error('App.loadSVG: file is required');
    }

    const isValidByMimeType  = file.type === 'image/svg+xml';
    const isValidByExtension = file.name.endsWith('.svg');

    if (!isValidByMimeType && !isValidByExtension) {
      throw new Error(
        'App.loadSVG: "' + file.name + '" is not a valid SVG file ' +
        '(expected .svg extension or image/svg+xml MIME type)'
      );
    }

    const svgHost = document.getElementById('svg-host');
    if (svgHost) svgHost.style.opacity = '0.3';

    try {
      const rawSVGText      = await readFileAsText(file);
      const sanitisedText   = sanitiseSVGText(rawSVGText);
      const liveSVGElement  = injectSVGIntoHost(sanitisedText);

      if (svgHost) svgHost.style.opacity = '1';

      window.App.updateConfig({ image: sanitisedText });
      window.App.markSVGLoaded(true);

      // parseSVG FIRST — populate App.shapes before hooks fire
      if (typeof window.App.parseSVG === 'function') {
        window.App.parseSVG(liveSVGElement);
      }

      // notifySVGLoaded SECOND — hooks receive data-ready shapes map
      window.App.notifySVGLoaded(liveSVGElement);

      return liveSVGElement;

    } catch (err) {
      // Always restore opacity so the host is not left in a loading state
      if (svgHost) svgHost.style.opacity = '1';
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Attach to App namespace immediately (no DOM access required)
  // ---------------------------------------------------------------------------

  window.App.loadSVG = loadSVG;

  // ---------------------------------------------------------------------------
  // DOM wiring — runs on DOMContentLoaded
  // ---------------------------------------------------------------------------

  document.addEventListener('DOMContentLoaded', function () {
    const svgFileInput        = document.getElementById('svg-file-input');
    const svgFileInputToolbar = document.getElementById('svg-file-input-toolbar');

    /**
     * Shared change handler: loads the selected file then resets the input so
     * the same file can be re-selected later if needed.
     * @param {Event} e
     */
    function handleSVGFileInputChange(e) {
      const selectedFile = e.target.files[0];
      if (!selectedFile) return;

      loadSVG(selectedFile).catch(function (err) {
        console.error('ArchFlow — SVG load error:', err);
      });

      // Reset so the same file triggers `change` again if re-selected
      e.target.value = '';
    }

    if (svgFileInput)        svgFileInput.addEventListener('change',        handleSVGFileInputChange);
    if (svgFileInputToolbar) svgFileInputToolbar.addEventListener('change', handleSVGFileInputChange);
  });

})();
