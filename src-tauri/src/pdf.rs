//! "Lagre som PDF": WebView2 prints the window's page straight to a PDF file
//! (no print dialog). The page decides what's printed with `@media print`
//! (see src/export/print.ts), so this only knows paper and margins.

/// Print the calling window's page to `path` (A4, 2 cm margins, no header/footer).
#[tauri::command]
pub async fn print_to_pdf(window: tauri::WebviewWindow, path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
        let fail = tx.clone();
        window
            .with_webview(move |webview| {
                if let Err(err) = unsafe { start(&webview, &path, tx) } {
                    let _ = fail.send(Err(err.message()));
                }
            })
            .map_err(|err| err.to_string())?;
        // with_webview runs on the main thread and the callback comes back there too;
        // this command runs on its own thread, so waiting here blocks nothing.
        tauri::async_runtime::spawn_blocking(move || rx.recv().unwrap_or_else(|_| Err("Utskriften ble avbrutt".into())))
            .await
            .map_err(|err| err.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (window, path);
        Err("PDF finnes bare på Windows foreløpig".into())
    }
}

#[cfg(windows)]
unsafe fn start(
    webview: &tauri::webview::PlatformWebview,
    path: &str,
    done: std::sync::mpsc::Sender<Result<(), String>>,
) -> windows_core::Result<()> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Environment6, ICoreWebView2_7, COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT,
    };
    use webview2_com::PrintToPdfCompletedHandler;
    use windows_core::{Interface, HSTRING};

    let core: ICoreWebView2_7 = webview.controller().CoreWebView2()?.cast()?;
    let env: ICoreWebView2Environment6 = webview.environment().cast()?;
    let settings = env.CreatePrintSettings()?;
    // Inches: A4 with 2 cm margins.
    settings.SetOrientation(COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT)?;
    settings.SetPageWidth(8.27)?;
    settings.SetPageHeight(11.69)?;
    let margin = 2.0 / 2.54;
    settings.SetMarginTop(margin)?;
    settings.SetMarginBottom(margin)?;
    settings.SetMarginLeft(margin)?;
    settings.SetMarginRight(margin)?;
    settings.SetShouldPrintBackgrounds(true)?;
    settings.SetShouldPrintHeaderAndFooter(false)?;

    let handler = PrintToPdfCompletedHandler::create(Box::new(move |result, ok| {
        let _ = done.send(match result {
            Err(err) => Err(err.message()),
            Ok(()) if !ok => Err("Kunne ikke skrive PDF-filen (er den åpen i et annet program?)".into()),
            Ok(()) => Ok(()),
        });
        Ok(())
    }));
    core.PrintToPdf(&HSTRING::from(path), &settings, &handler)
}
