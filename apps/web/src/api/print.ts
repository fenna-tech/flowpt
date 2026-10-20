// Print an HTML document through the browser's print dialog (which also offers "Save as PDF").
// The invoice HTML is escaped by the shared template and rendered in a sandboxed iframe with
// scripts disabled; only the parent triggers the print.
export function printHtml(html: string, title: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe')
    frame.setAttribute('sandbox', 'allow-modals allow-same-origin')
    frame.setAttribute('aria-hidden', 'true')
    Object.assign(frame.style, {
      position: 'fixed',
      right: '0',
      bottom: '0',
      width: '0',
      height: '0',
      border: '0'
    })
    const previousTitle = document.title
    const cleanup = (): void => {
      document.title = previousTitle
      frame.remove()
    }
    frame.onload = () => {
      const win = frame.contentWindow
      if (!win) {
        cleanup()
        reject(new Error('Could not open the print preview'))
        return
      }
      // Chrome names the saved PDF after the top-level page title.
      document.title = title
      win.addEventListener('afterprint', cleanup)
      try {
        win.focus()
        win.print()
      } catch (err) {
        cleanup()
        reject(err as Error)
        return
      }
      resolve()
    }
    // Letter paper with the same margins as the desktop PDF.
    frame.srcdoc = html.replace('<style>', '<style>@page{size:Letter;margin:.6in .7in}')
    document.body.appendChild(frame)
  })
}
