"use strict";
const vscode_1 = require("vscode");
const path = require("path");
const fileUrl = require("file-url");
const child_process_1 = require("child_process");
class RSTDocumentView {
    constructor(document) {
        this.registrations = [];
        this.doc = document;
        this.provider = new RSTDocumentContentProvider(this.doc);
        this.registrations.push(vscode_1.workspace.registerTextDocumentContentProvider("rst", this.provider));
        this.previewUri = this.getRSTUri(document.uri);
        this.registerEvents();
    }
    get uri() {
        return this.previewUri;
    }
    getRSTUri(uri) {
        return uri.with({ scheme: 'rst', path: uri.path + '.rendered', query: uri.toString() });
    }
    registerEvents() {
        vscode_1.workspace.onDidSaveTextDocument(document => {
            if (this.isRSTFile(document)) {
                const uri = this.getRSTUri(document.uri);
                this.provider.update(uri);
            }
        });
        vscode_1.workspace.onDidChangeTextDocument(event => {
            if (this.isRSTFile(event.document)) {
                const uri = this.getRSTUri(event.document.uri);
                this.provider.update(uri);
            }
        });
        vscode_1.workspace.onDidChangeConfiguration(() => {
            vscode_1.workspace.textDocuments.forEach(document => {
                if (document.uri.scheme === 'rst') {
                    // update all generated md documents
                    this.provider.update(document.uri);
                }
            });
        });
        this.registrations.push(vscode_1.workspace.onDidChangeTextDocument((e) => {
            if (!this.visible) {
                return;
            }
            if (e.document === this.doc) {
                this.provider.update(this.previewUri);
            }
        }));
    }
    get visible() {
        for (let i in vscode_1.window.visibleTextEditors) {
            if (vscode_1.window.visibleTextEditors[i].document.uri === this.previewUri) {
                return true;
            }
        }
        return false;
    }
    execute(column) {
        vscode_1.commands.executeCommand("vscode.previewHtml", this.previewUri, column, `Preview '${path.basename(this.uri.fsPath)}'`).then((success) => {
        }, (reason) => {
            console.warn(reason);
            vscode_1.window.showErrorMessage(reason);
        });
    }
    dispose() {
        for (let i in this.registrations) {
            this.registrations[i].dispose();
        }
    }
    isRSTFile(document) {
        return document.languageId === 'rst'
            && document.uri.scheme !== 'rst'; // prevent processing of own documents
    }
}
exports.RSTDocumentView = RSTDocumentView;
class RSTDocumentContentProvider {
    constructor(document) {
        this._onDidChange = new vscode_1.EventEmitter();
        this.doc = document;
    }
    provideTextDocumentContent(uri) {
        return this.createRSTSnippet();
    }
    get onDidChange() {
        return this._onDidChange.event;
    }
    update(uri) {
        this._onDidChange.fire(uri);
    }
    createRSTSnippet() {
        if (this.doc.languageId !== "rst") {
            return this.errorSnippet("Active editor doesn't show a RST document - no properties to preview.");
        }
        return this.preview();
    }
    errorSnippet(error) {
        return `
                <body>
                    ${error}
                </body>`;
    }
    buildPage(document, headerArgs) {
        return `
            <html lang="en">
            <head>
            ${headerArgs.join("\n")}
            </head>
            <body>
            ${document}
            </body>
            </html>`;
    }
    createStylesheet(file) {
        let href = fileUrl(path.join(__dirname, "..", "..", "static", file));
        return `<link href="${href}" rel="stylesheet" />`;
    }
    fixLinks(document, documentPath) {
        return document.replace(new RegExp("((?:src|href)=[\'\"])((?!http|\\/).*?)([\'\"])", "gmi"), (subString, p1, p2, p3) => {
            return [
                p1,
                fileUrl(path.join(path.dirname(documentPath), p2)),
                p3
            ].join("");
        });
    }
    preview() {
        return new Promise((resolve, reject) => {
            let cmd = [
                "python",
                path.join(__dirname, "..", "..", "src", "python", "preview.py"),
                this.doc.fileName
            ].join(" ");
            child_process_1.exec(cmd, (error, stdout, stderr) => {
                if (error) {
                    let errorMessage = [
                        error.name,
                        error.message,
                        error.stack,
                        "",
                        stderr.toString()
                    ].join("\n");
                    console.error(errorMessage);
                    reject(errorMessage);
                }
                else {
                    let result = this.fixLinks(stdout.toString(), this.doc.fileName);
                    let headerArgs = [
                        this.createStylesheet("basic.css"),
                        this.createStylesheet("default.css")
                    ];
                    resolve(this.buildPage(result, headerArgs));
                }
            });
        });
    }
}
//# sourceMappingURL=document.js.map