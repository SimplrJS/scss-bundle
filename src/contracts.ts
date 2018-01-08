import * as yargs from "yargs";

export interface Config {
    Entry: string;
    Destination: string;
    Verbosity: Verbosity;
    DedupeGlobs?: string[];
    IncludePaths?: string[];
}

export enum Verbosity {
    None = 0,
    Errors = 8,
    Verbose = 256
}

export interface ArgumentsValues extends yargs.Arguments {
    config?: string;
    entry: string;
    dest: string;
    verbosity: Verbosity;
    dedupe?: string[];
    includePaths?: string[];
}
