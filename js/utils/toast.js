/**
 * TileWeaver - Notification Toast System
 * --------------------------------------
 * Provides global toast messages to give instant feedback for user actions
 * (e.g. tileset uploaded, export complete, error alerts).
 */

(function() {
    window.TileWeaver = window.TileWeaver || {};
    window.TileWeaver = window.TileWeaver; // Backward-compatibility alias

    /**
     * Displays a temporary notification toast at top-center of the screen.
     * @param {string} text - Message text to display.
     * @param {('info'|'success'|'error')} [type='info'] - Message theme type.
     */
    function showMessage(text, type = 'info') {
        const msgBox = document.getElementById('message-box');
        const msgText = document.getElementById('message-text');
        const msgIcon = document.getElementById('message-icon');
        
        if (!msgBox || !msgText || !msgIcon) return;

        msgText.textContent = text;
        
        // Configure theme styling and icon based on notification type
        if (type === 'error') {
            msgIcon.className = "ph-fill ph-warning-circle text-red-400 text-lg";
            msgBox.className = "fixed top-16 left-1/2 transform -translate-x-1/2 bg-slate-800 border border-red-600 text-white px-5 py-2.5 rounded shadow-xl z-50 flex items-center gap-3 show";
        } else if (type === 'success') {
            msgIcon.className = "ph-fill ph-check-circle text-green-400 text-lg";
            msgBox.className = "fixed top-16 left-1/2 transform -translate-x-1/2 bg-slate-800 border border-green-600 text-white px-5 py-2.5 rounded shadow-xl z-50 flex items-center gap-3 show";
        } else {
            msgIcon.className = "ph-fill ph-info text-blue-400 text-lg";
            msgBox.className = "fixed top-16 left-1/2 transform -translate-x-1/2 bg-slate-800 border border-slate-600 text-white px-5 py-2.5 rounded shadow-xl z-50 flex items-center gap-3 show";
        }

        // Auto-dismiss after 2.5 seconds
        setTimeout(() => {
            msgBox.classList.remove('show');
        }, 2500);
    }

    // Expose toast module on window.TileWeaver namespace
    window.TileWeaver.toast = {
        showMessage
    };
    window.TileWeaver.toast = window.TileWeaver.toast;
})();
