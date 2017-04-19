import * as fs from "mz/fs";
import * as os from "os";
import * as path from "path";
import * as globs from "globs";

import * as Helpers from "./helpers";

const IMPORT_PATTERN = /@import ['"](.+)['"];/g;
const COMMENTED_IMPORT_PATTERN = /\/\/@import '(.+)';/g;
const FILE_EXTENSION = ".scss";

export interface FileRegistry {
    [id: string]: string | undefined;
}

export interface ImportData {
    importString: string;
    path: string;
    fullPath: string;
    found: boolean;
}

export interface BundleResult {
    // Child imports (if any)
    imports?: BundleResult[];
    deduped?: boolean;
    // Full path of the file
    filePath: string;
    bundledContent?: string;
    found: boolean;
}

export class Bundler {
    // Full paths of used imports and their count
    private usedImports: { [key: string]: number } = {};
    // Imports dictionary by file
    private importsByFile: { [key: string]: BundleResult[] } = {};

    constructor(private fileRegistry: FileRegistry = {}) { }

    public async BundleAll(
        files: string[],
        dedupeGlobs: string[]
    ): Promise<BundleResult[]> {
        const resultsPromises = files.map(file => this.Bundle(file, dedupeGlobs));
        return await Promise.all(resultsPromises);
    }

    public async Bundle(file: string, dedupeGlobs: string[] = []): Promise<BundleResult> {
        try {
            await fs.access(file);
            const contentPromise = fs.readFile(file, "utf-8");
            const dedupeFilesPromise = this.globFilesOrEmpty(dedupeGlobs);

            // Await all async operations and extract results
            const [content, dedupeFiles] = await Promise.all([contentPromise, dedupeFilesPromise]);

            return await this.bundle(file, content, dedupeFiles);
        } catch (error) {
            return {
                filePath: file,
                found: false
            };
        }
    }

    private async bundle(
        filePath: string,
        content: string,
        dedupeFiles: string[]
    ): Promise<BundleResult> {
        // Remove commented imports
        content = content.replace(COMMENTED_IMPORT_PATTERN, "");

        // Resolve path to work only with full paths
        filePath = path.resolve(filePath);

        const dirname = path.dirname(filePath);

        if (this.fileRegistry[filePath] == null) {
            this.fileRegistry[filePath] = content;
        }

        // Resolve imports file names (prepend underscore for partials)
        const importsPromises = Helpers.getAllMatches(content, IMPORT_PATTERN).map(async match => {
            let importName = match[1];
            // Append extension if it's absent
            if (importName.indexOf(FILE_EXTENSION) === -1) {
                importName += FILE_EXTENSION;
            }
            const fullPath = path.resolve(dirname, importName);

            const importData: ImportData = {
                importString: match[0],
                path: importName,
                fullPath: fullPath,
                found: false
            };

            try {
                await fs.access(fullPath);
                importData.found = true;
            } catch (error) {
                const underscoredDirname = path.dirname(fullPath);
                const underscoredBasename = path.basename(fullPath);
                const underscoredFilePath = path.join(underscoredDirname, `_${underscoredBasename}`);
                try {
                    await fs.access(underscoredFilePath);
                    importData.fullPath = underscoredFilePath;
                    importData.found = true;
                } catch (underscoreErr) {
                    // Neither file, nor partial was found
                    // Skipping...
                }
            }

            return importData;
        });

        // Wait for all imports file names to be resolved
        const imports = await Promise.all(importsPromises);

        const bundleResult: BundleResult = {
            filePath: filePath,
            found: true
        };

        const shouldCheckForDedupes = dedupeFiles != null && dedupeFiles.length > 0;

        // Bundle all imports
        const currentImports: BundleResult[] = [];
        for (const imp of imports) {
            let contentToReplace;

            let currentImport: BundleResult;

            // If neither import file, nor partial is found
            if (!imp.found) {
                // Add empty bundle result with found: false
                currentImport = {
                    filePath: imp.fullPath,
                    found: false
                };
            } else if (this.fileRegistry[imp.fullPath] == null) {
                // If file is not yet in the registry
                // Read
                let impContent = await fs.readFile(imp.fullPath, "utf-8");

                // and bundle it
                let bundledImport = await this.bundle(imp.fullPath, impContent, dedupeFiles);

                // Then add its bundled content to the registry
                this.fileRegistry[imp.fullPath] = bundledImport.bundledContent;

                // Add it to used imports, if it's not there
                if (this.usedImports != null && this.usedImports[imp.fullPath] == null) {
                    this.usedImports[imp.fullPath] = 1;
                }

                // And whole BundleResult to current imports
                currentImport = bundledImport;
            } else {
                // File is in the registry
                // Increment it's usage count
                if (this.usedImports != null) {
                    this.usedImports[imp.fullPath]++;
                }

                // Resolve child imports, if there are any
                let childImports: BundleResult[] = [];
                if (this.importsByFile != null) {
                    childImports = this.importsByFile[imp.fullPath];
                }

                // Construct and add result to current imports
                currentImport = {
                    filePath: imp.fullPath,
                    found: true,
                    imports: childImports
                };
            }

            // Take contentToReplace from the fileRegistry
            contentToReplace = this.fileRegistry[imp.fullPath];

            // If the content is not found
            if (contentToReplace == null) {
                // Indicate this with a comment for easier debugging
                contentToReplace = `/*** IMPORTED FILE NOT FOUND ***/${os.EOL}${imp.importString}/*** --- ***/`;
            }

            // If usedImports dictionary is defined
            if (shouldCheckForDedupes && this.usedImports != null) {
                // And current import path should be deduped and is used already
                const timesUsed = this.usedImports[imp.fullPath];
                if (dedupeFiles.indexOf(imp.fullPath) !== -1 &&
                    timesUsed != null &&
                    timesUsed > 1) {
                    // Reset content to an empty string to skip it
                    content = "";
                    // And indicate that import was deduped
                    currentImport.deduped = true;
                }
            }

            // Finally, replace import string with bundled content or a debug message
            content = content.replace(imp.importString, contentToReplace);

            // And push current import into the list
            currentImports.push(currentImport);
        }

        // Set result properties
        bundleResult.bundledContent = content;
        bundleResult.imports = currentImports;

        if (this.importsByFile != null) {
            this.importsByFile[filePath] = currentImports;
        }

        return bundleResult;
    }

    private async globFilesOrEmpty(globsList: string[]) {
        return new Promise<string[]>((resolve, reject) => {
            if (globsList == null || globsList.length === 0) {
                resolve([]);
                return;
            }
            globs(globsList, (err: Error, files: string[]) => {
                // Reject if there's an error
                if (err) {
                    reject(err);
                }

                // Resolve full paths
                const result = files.map(file => path.resolve(file));

                // Resolve promise
                resolve(result);
            });
        });
    }
}
