#!/usr/bin/env node

import * as path from 'path';
import * as chokidar from 'chokidar';
// tslint:disable-next-line:no-require-imports
import debounce = require('lodash.debounce');

import * as Contracts from './contracts';
import { argv } from './arguments';
import { Launcher } from './launcher';

function resolveVerbosity(verbosity: any): number {
  // Convert given value to an appropriate Verbosity enum value.
  // 'as any as number' is used because TypeScript thinks
  //  that we cast string to number, even though we get a number there
  return (Contracts.Verbosity[verbosity] as any) as number;
}

function argumentsToConfig(
  argumentValues: Contracts.ArgumentsValues
): Contracts.Config {
  return {
    Destination: argumentValues.dest,
    Entry: argumentValues.entry,
    DedupeGlobs: argumentValues.dedupe,
    Verbosity: resolveVerbosity(argumentValues.verbosity),
    IncludePaths: argumentValues.includePaths,
    IgnoredImports: argumentValues.ignoredImports,
    ProjectDirectory: path.resolve(process.cwd(), argumentValues.project)
  };
}

async function main(argumentValues: Contracts.ArgumentsValues): Promise<void> {
  const config = argumentsToConfig(argumentValues);
  const isWatching = argumentValues.watch !== null;
  const noWatch = argumentValues.watch === '';
  const bundler = new Launcher(config);

  if (
    argumentValues.verbosity !== Contracts.Verbosity.None &&
    (argumentValues.entry == null || argumentValues.dest == null)
  ) {
    console.error("[Error] 'entry' and 'dest' are required.");
    process.exit(1);
  }

  if (
    argumentValues.verbosity !== Contracts.Verbosity.None &&
    !noWatch &&
    isWatching &&
    argumentValues.watch == null
  ) {
    console.error("[Error] 'watch' must be defined.");
    process.exit(1);
  }

  if (!noWatch && isWatching && !Contracts.Verbosity.None) {
    const onFilesChange = debounce(async () => {
      if (config.Verbosity === Contracts.Verbosity.Verbose) {
        console.info('[Watcher] Waiting for changes...');
      }
      await bundler.Bundle();
    }, 500);
    chokidar.watch(argumentValues.watch).on('change', onFilesChange);
  }

  await bundler.Bundle();

  if (
    !noWatch &&
    isWatching &&
    config.Verbosity === Contracts.Verbosity.Verbose
  ) {
    console.info('[Watcher] Waiting for changes...');
  } else {
    process.exit();
  }
}

main(argv);
