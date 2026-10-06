document.addEventListener("DOMContentLoaded", async function () {

    const loading = document.getElementById("loading");
    const loadingScreen = document.getElementById("loading-screen");

    function status(message) {
        console.log(message);

        if (loading) {
            loading.textContent = message;
        }
    }

    try {

        status("TEST 1: Game JavaScript is running...");

        await new Promise(resolve =>
            setTimeout(resolve, 500)
        );


        // ------------------------------------------------
        // TEST 2: Check JSZip
        // ------------------------------------------------

        if (typeof JSZip === "undefined") {
            throw new Error(
                "JSZip is NOT loaded."
            );
        }

        status(
            "TEST 2: JSZip is loaded ✓"
        );

        await new Promise(resolve =>
            setTimeout(resolve, 500)
        );


        // ------------------------------------------------
        // TEST 3: Download ZIP
        // ------------------------------------------------

        status(
            "TEST 3: Downloading marvel_pages.zip..."
        );

        const response =
            await fetch("../marvel_pages.zip");

        if (!response.ok) {
            throw new Error(
                "GitHub could not load marvel_pages.zip. HTTP status: " +
                response.status
            );
        }

        status(
            "TEST 3: ZIP downloaded ✓"
        );

        await new Promise(resolve =>
            setTimeout(resolve, 500)
        );


        // ------------------------------------------------
        // TEST 4: Read ZIP
        // ------------------------------------------------

        status(
            "TEST 4: Opening ZIP file..."
        );

        const buffer =
            await response.arrayBuffer();

        status(
            "TEST 4: ZIP converted to memory ✓"
        );

        await new Promise(resolve =>
            setTimeout(resolve, 500)
        );


        const zip =
            await JSZip.loadAsync(buffer);

        status(
            "TEST 5: ZIP opened successfully ✓"
        );

        console.log(
            "ZIP files:",
            Object.keys(zip.files)
        );

        await new Promise(resolve =>
            setTimeout(resolve, 500)
        );


        // ------------------------------------------------
        // TEST 6: Find HTML pages
        // ------------------------------------------------

        const files =
            Object.keys(zip.files).filter(
                filename => {

                    const lower =
                        filename.toLowerCase();

                    return (
                        lower.endsWith(".html") ||
                        lower.endsWith(".htm") ||
                        lower.endsWith(".txt")
                    );
                }
            );

        status(
            "TEST 6: Found " +
            files.length +
            " page files ✓"
        );

        console.log(
            "Page files:",
            files
        );


        await new Promise(resolve =>
            setTimeout(resolve, 1000)
        );


        // ------------------------------------------------
        // SUCCESS
        // ------------------------------------------------

        status(
            "SUCCESS! The dataset is working. " +
            files.length +
            " pages found."
        );

        if (loadingScreen) {
            loadingScreen.style.background =
                "#eaf7ee";
        }

    } catch (error) {

        console.error(
            "GAME TEST ERROR:",
            error
        );

        status(
            "ERROR: " +
            error.message
        );
    }

});
