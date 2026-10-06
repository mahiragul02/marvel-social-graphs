// ============================================================
// MARVEL TEXT DETECTIVE — WEEK 5 FIGURE
// Textual Similarity vs Network Connection
// ============================================================

const FIGURE_WIDTH = 850;
const FIGURE_HEIGHT = 500;


// ------------------------------------------------------------
// Load a TSV file
// ------------------------------------------------------------

async function loadTSV(path) {

    const response = await fetch(path);

    if (!response.ok) {
        throw new Error(
            `Could not load ${path} (${response.status})`
        );
    }

    const text = await response.text();

    return text
        .trim()
        .split(/\r?\n/)
        .map(line => line.split("\t"));
}


// ------------------------------------------------------------
// Convert TSV rows to objects
// ------------------------------------------------------------

function parseTSV(rows) {

    if (!rows.length) {
        return [];
    }

    const header = rows[0];

    return rows.slice(1).map(row => {

        const obj = {};

        header.forEach((key, index) => {
            obj[key.trim()] =
                row[index] ? row[index].trim() : "";
        });

        return obj;
    });
}


// ------------------------------------------------------------
// Find column automatically
// ------------------------------------------------------------

function findColumn(object, possibleNames) {

    const keys = Object.keys(object);

    for (const key of keys) {

        const lower = key.toLowerCase();

        for (const name of possibleNames) {

            if (lower === name.toLowerCase()) {
                return key;
            }

        }

    }

    return null;
}


// ------------------------------------------------------------
// Clean character/page names
// ------------------------------------------------------------

function normalizeName(name) {

    return name
        .toLowerCase()
        .replace(/\.html?$/i, "")
        .replace(/\.txt$/i, "")
        .replace(/\.wiki$/i, "")
        .replace(/_/g, " ")
        .replace(/-/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}


// ------------------------------------------------------------
// Stopwords
// ------------------------------------------------------------

const STOPWORDS = new Set([

    "the",
    "and",
    "of",
    "to",
    "in",
    "a",
    "is",
    "for",
    "on",
    "with",
    "as",
    "by",
    "an",
    "at",
    "from",
    "that",
    "this",
    "was",
    "were",
    "it",
    "his",
    "her",
    "he",
    "she",
    "they",
    "their",
    "be",
    "has",
    "had",
    "have",
    "or",
    "which",
    "who",
    "also",
    "but",
    "not",
    "into",
    "its",
    "are",
    "been",
    "being",
    "can",
    "may",
    "one",
    "two",
    "three",
    "than",
    "then",
    "these",
    "those",
    "more",
    "most",
    "other",
    "some",
    "such",
    "their",
    "there",
    "about",
    "after",
    "before",
    "during",
    "over",
    "under",
    "between",
    "through",
    "while",
    "where",
    "when",
    "what",
    "how",
    "all",
    "any",
    "both",
    "each",
    "only",
    "very",
    "first",
    "second",
    "last",
    "new",
    "used",
    "use",
    "often",
    "known"

]);


// ------------------------------------------------------------
// Convert text to Bag-of-Words vector
// ------------------------------------------------------------

function textToVector(text) {

    const cleanText = text
        .toLowerCase()
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]*>/g, " ")
        .replace(/[^a-z0-9\s]/g, " ");

    const words = cleanText
        .split(/\s+/)
        .filter(word =>
            word.length >= 3 &&
            !STOPWORDS.has(word)
        );

    const vector = {};

    for (const word of words) {

        vector[word] =
            (vector[word] || 0) + 1;

    }

    return vector;
}


// ------------------------------------------------------------
// Cosine similarity
// ------------------------------------------------------------

function cosineSimilarity(a, b) {

    let dot = 0;
    let normA = 0;
    let normB = 0;

    const smaller =
        Object.keys(a).length <
        Object.keys(b).length
            ? a
            : b;

    const larger =
        smaller === a
            ? b
            : a;

    for (const word in smaller) {

        if (larger[word]) {

            dot +=
                smaller[word] *
                larger[word];

        }

    }

    for (const word in a) {
        normA += a[word] * a[word];
    }

    for (const word in b) {
        normB += b[word] * b[word];
    }

    if (normA === 0 || normB === 0) {
        return 0;
    }

    return dot /
        (Math.sqrt(normA) * Math.sqrt(normB));
}


// ------------------------------------------------------------
// Deterministic random number generator
// ------------------------------------------------------------

function seededRandom(seed) {

    let value = seed;

    return function () {

        value =
            (value * 9301 + 49297) % 233280;

        return value / 233280;

    };
}


// ------------------------------------------------------------
// Shuffle
// ------------------------------------------------------------

function shuffle(array, seed = 42) {

    const result = [...array];

    const random = seededRandom(seed);

    for (
        let i = result.length - 1;
        i > 0;
        i--
    ) {

        const j =
            Math.floor(random() * (i + 1));

        [
            result[i],
            result[j]
        ] =
        [
            result[j],
            result[i]
        ];

    }

    return result;
}


// ============================================================
// MAIN
// ============================================================

async function buildFigure() {

    const status =
        document.getElementById(
            "figure-status"
        );

    try {

        status.textContent =
            "Loading Marvel network…";


        // ----------------------------------------------------
        // Load network
        // ----------------------------------------------------

        const nodeRows =
            await loadTSV(
                "../week1_nodes.tsv"
            );

        const edgeRows =
            await loadTSV(
                "../week1_edges.tsv"
            );

        const nodes =
            parseTSV(nodeRows);

        const edges =
            parseTSV(edgeRows);


        console.log(
            "Marvel nodes:",
            nodes.length
        );

        console.log(
            "Marvel edges:",
            edges.length
        );


        if (!nodes.length) {
            throw new Error(
                "No nodes were found."
            );
        }


        // ----------------------------------------------------
        // Detect columns
        // ----------------------------------------------------

        const nodeNameColumn =
            findColumn(
                nodes[0],
                [
                    "name",
                    "label",
                    "title",
                    "id",
                    "node"
                ]
            );


        const sourceColumn =
            findColumn(
                edges[0],
                [
                    "source",
                    "from",
                    "source_id"
                ]
            );


        const targetColumn =
            findColumn(
                edges[0],
                [
                    "target",
                    "to",
                    "target_id"
                ]
            );


        if (!nodeNameColumn) {

            throw new Error(
                "Could not find the character name column."
            );

        }


        if (!sourceColumn || !targetColumn) {

            throw new Error(
                "Could not find source/target columns."
            );

        }


        console.log(
            "Node name column:",
            nodeNameColumn
        );

        console.log(
            "Source column:",
            sourceColumn
        );

        console.log(
            "Target column:",
            targetColumn
        );


        // ----------------------------------------------------
        // Character names
        // ----------------------------------------------------

        const characterNames =
            nodes
                .map(
                    node =>
                        node[nodeNameColumn]
                )
                .filter(Boolean);


        const nameLookup =
            new Map();


        characterNames.forEach(name => {

            nameLookup.set(
                normalizeName(name),
                name
            );

        });


        // ----------------------------------------------------
        // Network connections
        // ----------------------------------------------------

        const connectedPairs =
            new Set();


        edges.forEach(edge => {

            const source =
                edge[sourceColumn];

            const target =
                edge[targetColumn];


            if (!source || !target) {
                return;
            }


            const sourceName =
                nameLookup.get(
                    normalizeName(source)
                ) || source;


            const targetName =
                nameLookup.get(
                    normalizeName(target)
                ) || target;


            connectedPairs.add(
                `${normalizeName(sourceName)}|||${normalizeName(targetName)}`
            );

            connectedPairs.add(
                `${normalizeName(targetName)}|||${normalizeName(sourceName)}`
            );

        });


        console.log(
            "Network connections:",
            connectedPairs.size
        );


        // ----------------------------------------------------
        // Load ZIP
        // ----------------------------------------------------

        status.textContent =
            "Loading Marvel Wikipedia pages…";


        if (
            typeof JSZip === "undefined"
        ) {

            throw new Error(
                "JSZip is not available."
            );

        }


        const zipResponse =
            await fetch(
                "../marvel_pages.zip"
            );


        if (!zipResponse.ok) {

            throw new Error(
                `Could not load marvel_pages.zip (${zipResponse.status})`
            );

        }


        const zipData =
            await zipResponse.arrayBuffer();


        const zip =
            await JSZip.loadAsync(
                zipData
            );


        const pageFiles =
            Object.keys(zip.files)
                .filter(
                    filename =>
                        !zip.files[filename].dir
                );


        console.log(
            "Files inside ZIP:",
            pageFiles.length
        );


        // ----------------------------------------------------
        // Read pages
        // ----------------------------------------------------

        const pages = {};


        for (
            const filename of pageFiles
        ) {

            const file =
                zip.files[filename];


            const content =
                await file.async("text");


            const filenameOnly =
                filename
                    .split("/")
                    .pop();


            const pageName =
                filenameOnly
                    .replace(/\.(html?|txt)$/i, "")
                    .replace(/_/g, " ")
                    .trim();


            if (pageName) {

                pages[
                    normalizeName(pageName)
                ] = {
                    name: pageName,
                    text: content
                };

            }

        }


        console.log(
            "Pages available:",
            Object.keys(pages).length
        );


        // ----------------------------------------------------
        // Match pages to characters
        // ----------------------------------------------------

        const vectors = {};

        let matchedPages = 0;


        for (
            const character of characterNames
        ) {

            const normalized =
                normalizeName(character);


            let page =
                pages[normalized];


            // Try partial matching
            if (!page) {

                const possibleKey =
                    Object.keys(pages)
                        .find(key => {

                            return (
                                key.includes(normalized) ||
                                normalized.includes(key)
                            );

                        });


                if (possibleKey) {
                    page = pages[possibleKey];
                }

            }


            if (page) {

                vectors[character] =
                    textToVector(
                        page.text
                    );

                matchedPages++;

            }

        }


        console.log(
            "Characters matched with text:",
            matchedPages
        );


        if (matchedPages < 10) {

            throw new Error(
                `Only ${matchedPages} character pages matched. ` +
                `The ZIP filenames do not match the node names closely enough.`
            );

        }


        // ----------------------------------------------------
        // Characters available for analysis
        // ----------------------------------------------------

        const names =
            Object.keys(vectors);


        // ----------------------------------------------------
        // Calculate connected pairs
        // ----------------------------------------------------

        const connected = [];


        const seenConnected =
            new Set();


        for (
            const edge of edges
        ) {

            const source =
                edge[sourceColumn];

            const target =
                edge[targetColumn];


            const sourceName =
                nameLookup.get(
                    normalizeName(source)
                );

            const targetName =
                nameLookup.get(
                    normalizeName(target)
                );


            if (
                !sourceName ||
                !targetName
            ) {
                continue;
            }


            if (
                !vectors[sourceName] ||
                !vectors[targetName]
            ) {
                continue;
            }


            const pairKey =
                [
                    normalizeName(sourceName),
                    normalizeName(targetName)
                ]
                .sort()
                .join("|||");


            if (
                seenConnected.has(pairKey)
            ) {
                continue;
            }


            seenConnected.add(pairKey);


            const similarity =
                cosineSimilarity(
                    vectors[sourceName],
                    vectors[targetName]
                );


            connected.push({

                a: sourceName,

                b: targetName,

                similarity

            });

        }


        // ----------------------------------------------------
        // Generate non-connected candidate pairs
        // ----------------------------------------------------

        status.textContent =
            "Comparing character pages…";


        const nonConnectedCandidates = [];


        for (
            let i = 0;
            i < names.length;
            i++
        ) {

            for (
                let j = i + 1;
                j < names.length;
                j++
            ) {

                const a =
                    names[i];

                const b =
                    names[j];


                const pairKey =
                    [
                        normalizeName(a),
                        normalizeName(b)
                    ]
                    .sort()
                    .join("|||");


                if (
                    seenConnected.has(pairKey)
                ) {
                    continue;
                }


                nonConnectedCandidates.push({
                    a,
                    b
                });

            }

        }


        // ----------------------------------------------------
        // Sample same number of non-connected pairs
        // ----------------------------------------------------

        const shuffled =
            shuffle(
                nonConnectedCandidates,
                2026
            );


        const sampleSize =
            Math.min(
                connected.length,
                shuffled.length
            );


        const nonConnected =
            shuffled
                .slice(0, sampleSize)
                .map(pair => ({

                    a: pair.a,

                    b: pair.b,

                    similarity:
                        cosineSimilarity(
                            vectors[pair.a],
                            vectors[pair.b]
                        )

                }));


        console.log(
            "Connected pairs:",
            connected.length
        );

        console.log(
            "Sampled non-connected pairs:",
            nonConnected.length
        );


        // ====================================================
        // DRAW FIGURE
        // ====================================================

        const canvas =
            document.getElementById(
                "similarity-figure"
            );


        const ctx =
            canvas.getContext("2d");


        canvas.width =
            FIGURE_WIDTH;

        canvas.height =
            FIGURE_HEIGHT;


        ctx.clearRect(
            0,
            0,
            FIGURE_WIDTH,
            FIGURE_HEIGHT
        );


        // ----------------------------------------------------
        // Layout
        // ----------------------------------------------------

        const margin = {

            left: 100,

            right: 40,

            top: 65,

            bottom: 80

        };


        const plotWidth =
            FIGURE_WIDTH -
            margin.left -
            margin.right;


        const plotHeight =
            FIGURE_HEIGHT -
            margin.top -
            margin.bottom;


        const allData =
            [
                ...connected,
                ...nonConnected
            ];


        const maxSimilarity =
            Math.max(
                ...allData.map(
                    p => p.similarity
                ),
                0.1
            );


        // ----------------------------------------------------
        // Background
        // ----------------------------------------------------

        ctx.fillStyle =
            "#ffffff";

        ctx.fillRect(
            0,
            0,
            FIGURE_WIDTH,
            FIGURE_HEIGHT
        );


        // ----------------------------------------------------
        // Title
        // ----------------------------------------------------

        ctx.fillStyle =
            "#172033";

        ctx.font =
            "bold 22px Arial";

        ctx.textAlign =
            "center";


        ctx.fillText(
            "Textual Similarity vs. Network Connection",
            FIGURE_WIDTH / 2,
            32
        );


        // ----------------------------------------------------
        // Grid
        // ----------------------------------------------------

        ctx.strokeStyle =
            "#e5e7eb";

        ctx.lineWidth = 1;


        for (
            let i = 0;
            i <= 5;
            i++
        ) {

            const y =
                margin.top +
                (plotHeight / 5) * i;


            ctx.beginPath();

            ctx.moveTo(
                margin.left,
                y
            );

            ctx.lineTo(
                FIGURE_WIDTH -
                margin.right,
                y
            );

            ctx.stroke();

        }


        // ----------------------------------------------------
        // Axes
        // ----------------------------------------------------

        ctx.strokeStyle =
            "#374151";

        ctx.lineWidth = 1.5;


        ctx.beginPath();

        ctx.moveTo(
            margin.left,
            margin.top
        );

        ctx.lineTo(
            margin.left,
            FIGURE_HEIGHT -
            margin.bottom
        );

        ctx.lineTo(
            FIGURE_WIDTH -
            margin.right,
            FIGURE_HEIGHT -
            margin.bottom
        );

        ctx.stroke();


        // ----------------------------------------------------
        // X axis
        // ----------------------------------------------------

        ctx.fillStyle =
            "#374151";

        ctx.font =
            "14px Arial";

        ctx.textAlign =
            "center";


        ctx.fillText(
            "Cosine textual similarity",
            FIGURE_WIDTH / 2,
            FIGURE_HEIGHT - 25
        );


        // ----------------------------------------------------
        // X tick labels
        // ----------------------------------------------------

        for (
            let i = 0;
            i <= 5;
            i++
        ) {

            const value =
                (maxSimilarity / 5) * i;


            const x =
                margin.left +
                (plotWidth / 5) * i;


            ctx.fillText(
                value.toFixed(2),
                x,
                FIGURE_HEIGHT -
                margin.bottom +
                25
            );

        }


        // ----------------------------------------------------
        // Y axis labels
        // ----------------------------------------------------

        ctx.save();


        ctx.translate(
            25,
            FIGURE_HEIGHT / 2
        );


        ctx.rotate(
            -Math.PI / 2
        );


        ctx.fillText(
            "Network relationship",
            0,
            0
        );


        ctx.restore();


        ctx.textAlign =
            "right";

        ctx.font =
            "bold 14px Arial";


        ctx.fillText(
            "Connected",
            margin.left - 12,
            margin.top +
            plotHeight * 0.25 +
            5
        );


        ctx.fillText(
            "Not connected",
            margin.left - 12,
            margin.top +
            plotHeight * 0.72 +
            5
        );


        // ----------------------------------------------------
        // Draw points with small deterministic jitter
        // ----------------------------------------------------

        const random =
            seededRandom(12345);


        function drawPoints(
            data,
            baseY,
            fill
        ) {

            ctx.fillStyle =
                fill;


            data.forEach(point => {

                const x =
                    margin.left +
                    (
                        point.similarity /
                        maxSimilarity
                    ) *
                    plotWidth;


                const jitter =
                    (random() - 0.5) *
                    55;


                const y =
                    baseY +
                    jitter;


                ctx.beginPath();


                ctx.arc(
                    x,
                    y,
                    3,
                    0,
                    Math.PI * 2
                );


                ctx.fill();

            });

        }


        // Connected
        drawPoints(
            connected,
            margin.top +
            plotHeight * 0.25,
            "#2563eb"
        );


        // Not connected
        drawPoints(
            nonConnected,
            margin.top +
            plotHeight * 0.72,
            "#9ca3af"
        );


        // ----------------------------------------------------
        // Legend
        // ----------------------------------------------------

        ctx.textAlign =
            "left";

        ctx.font =
            "13px Arial";


        ctx.fillStyle =
            "#2563eb";


        ctx.beginPath();

        ctx.arc(
            FIGURE_WIDTH - 210,
            25,
            4,
            0,
            Math.PI * 2
        );

        ctx.fill();


        ctx.fillStyle =
            "#374151";


        ctx.fillText(
            "Connected",
            FIGURE_WIDTH - 198,
            30
        );


        ctx.fillStyle =
            "#9ca3af";


        ctx.beginPath();

        ctx.arc(
            FIGURE_WIDTH - 210,
            45,
            4,
            0,
            Math.PI * 2
        );

        ctx.fill();


        ctx.fillStyle =
            "#374151";


        ctx.fillText(
            "Not connected",
            FIGURE_WIDTH - 198,
            50
        );


        // ====================================================
        // STRONGEST TEXTUAL MATCHES
        // ====================================================

        const strongest =
            [...allData]
                .sort(
                    (a, b) =>
                        b.similarity -
                        a.similarity
                )
                .slice(0, 5);


        const list =
            document.getElementById(
                "strongest-matches"
            );


        list.innerHTML = "";


        strongest.forEach(
            pair => {

                const li =
                    document.createElement(
                        "li"
                    );


                const isConnected =
                    seenConnected.has(
                        [
                            normalizeName(pair.a),
                            normalizeName(pair.b)
                        ]
                        .sort()
                        .join("|||")
                    );


                li.textContent =
                    `${pair.a} ↔ ${pair.b} — ` +
                    `similarity ${pair.similarity.toFixed(3)} ` +
                    `(${isConnected ? "connected" : "not connected"})`;


                list.appendChild(li);

            }
        );


        // ----------------------------------------------------
        // Status
        // ----------------------------------------------------

        status.textContent =
            `Generated from ${matchedPages} Marvel pages: ` +
            `${connected.length} connected pairs and ` +
            `${nonConnected.length} sampled non-connected pairs.`;

    }


    catch (error) {

        console.error(
            "Week 5 figure error:",
            error
        );


        status.textContent =
            "The figure could not be generated. " +
            "Open the browser console (F12 → Console) " +
            "to see the error.";

    }

}


// ------------------------------------------------------------
// Start when page loads
// ------------------------------------------------------------

document.addEventListener(
    "DOMContentLoaded",
    buildFigure
);
