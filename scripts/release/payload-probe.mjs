// Executed by the bundled Node with the installed payload as cwd. No browser,
// model download or GPU initialization: exercise actual native bindings/tools.
import {createRequire} from 'node:module';
import path from 'node:path';
const require = createRequire(path.join(process.cwd(), 'package.json'));
const sharp = require('sharp');
const esbuild = require('esbuild');
const ort = require('onnxruntime-node');
require('@rspack/binding');
const {getVideoMetadata} = require('@remotion/renderer');
const image = await sharp('public/demo/demo-world.png').metadata();
if(!image.width) throw new Error('Built-in media is missing.');
if(!esbuild.transformSync('const value: number = 1;', {loader: 'ts'}).code.includes('value')) throw new Error('Bundled esbuild did not transform TypeScript.');
if(typeof ort.InferenceSession?.create !== 'function') throw new Error('ONNX native binding is missing.');
const metadata = await getVideoMetadata(process.argv[2], {logLevel: 'error'});
if(metadata.width !== 32 || metadata.height !== 32) throw new Error('Remotion compositor could not read the packaged media fixture.');
console.log('Bundled Node, Sharp, esbuild, ONNX, Rspack and Remotion compositor passed.');
