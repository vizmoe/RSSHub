import path from 'node:path';
import { format } from 'node:util';

import { nodeFileTrace } from '@vercel/nft';
import fs from 'fs-extra';

const __dirname = import.meta.dirname;
// !!! if any new dependencies are added, update the Dockerfile !!!

const projectRoot = path.resolve(process.env.PROJECT_ROOT || path.join(__dirname, '../..'));
const resultFolder = path.join(projectRoot, 'app-minimal'); // no need to resolve, ProjectRoot is always absolute
const files = ['dist/index.mjs', 'node_modules/cross-env/dist/bin/cross-env.js', 'node_modules/.bin/cross-env'].map((file) => path.join(projectRoot, file));

process.stdout.write(`Start analyzing, project root: ${projectRoot}\n`);
const { fileList: fileSet } = await nodeFileTrace(files, {
    base: projectRoot,
});
let fileList = [...fileSet];
process.stdout.write(`Total touchable files: ${fileList.length}\n`);
fileList = fileList.filter((file) => file.startsWith('node_modules/')); // only need node_modules

// playwright-core uses path.join to load browsers.json in v1.60+ instead of ../.., which prevents @vercel/nft from tracing it.
// https://github.com/microsoft/playwright/blob/v1.60.0/packages/playwright-core/src/server/registry/index.ts#L1544 vs
// https://github.com/microsoft/playwright/blob/v1.59.1/packages/playwright-core/src/server/registry/index.ts#L1520
// also, nft's special case for `playwright-core` no longer works for `patchright-core` https://github.com/vercel/nft/blob/1.10.2/src/utils/special-cases.ts#L336
const patchrightCoreFile = fileList.find((file) => file.includes('/patchright-core/'));
if (patchrightCoreFile) {
    const packageRoot = patchrightCoreFile.slice(0, patchrightCoreFile.indexOf('/patchright-core/') + '/patchright-core'.length);
    const browsersJson = `${packageRoot}/browsers.json`;
    if (!fileList.includes(browsersJson) && (await fs.pathExists(path.join(projectRoot, browsersJson)))) {
        fileList.push(browsersJson);
        process.stdout.write(`Manually included patchright-core asset: ${browsersJson}\n`);
    }
}
// oxc-parser loads its raw-transfer deserializers with a template-literal require through createRequire(import.meta.url),
// which @vercel/nft does not expand.
// https://github.com/oxc-project/oxc/blob/crates_v0.151.0/napi/parser/src-js/raw-transfer/eager.js#L75-L77
const oxcEagerFile = fileList.find((file) => file.endsWith('/oxc-parser/src-js/raw-transfer/eager.js'));
if (oxcEagerFile) {
    const deserializeDir = oxcEagerFile.replace(/raw-transfer\/eager\.js$/, 'generated/deserialize');
    if (await fs.pathExists(path.join(projectRoot, deserializeDir))) {
        fileList.push(deserializeDir);
        process.stdout.write(`Manually included oxc-parser asset: ${deserializeDir}\n`);
    }
}

process.stdout.write(`Total files need to be copied (touchable files in node_modules/): ${fileList.length}\n`);
process.stdout.write(`Start copying files, destination: ${resultFolder}\n`);
try {
    await Promise.all(fileList.map((e) => fs.copy(path.join(projectRoot, e), path.join(resultFolder, e))));
} catch (error) {
    // fix unhandled promise rejections
    process.stderr.write(`${format(error, error.stack)}\n`);
    process.exit(1);
}
