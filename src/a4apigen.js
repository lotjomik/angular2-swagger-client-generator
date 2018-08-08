#!/usr/bin/env node

/**
 * Command line interface (CLI) for generator.
 * @package angular4-swagger-client-generator
 * @author Michal Krchnavy <michal@krchnavy.sk>
 */
var optimist = require('optimist')
    .usage('Usage: a4apigen -s path/to/swagger.json')
    .alias('h', 'help')
    .alias('s', 'source')
    .alias('u', 'url')
    .alias('o', 'outputpath')
    .describe('s', 'Path to the swagger.json file')
    .describe('u', 'URL of the swagger.json file')
    .describe('o', 'Path where to store the generated files');

var fs = require('fs');

var genRef = require('./generator');

var argv = optimist.argv;

function stderr(err) {
    console.log('Error: ' + err);
    process.exit(1);
}

if (argv.help) {
    optimist.showHelp();
    process.exit(0);
}

var fromSource = false;
var fromUrl = false;
if (typeof argv.source !== 'undefined' && argv.source !== true) {
    fromSource = true;
}
else if (typeof argv.url !== 'undefined' && argv.url !== true) {
    fromUrl = true;
}
else {
    stderr('Swagger.json file (-s) or url (-u) must be specified. See --help');
    process.exit(1);
}

var outputdir = argv.outputpath || './output';

if (!fs.existsSync(outputdir)) {
    fs.mkdirSync(outputdir);
}

var sourceFile = argv.source;

if (fromUrl) {
    var request = require('request');
    var path = require('path');
    var fs = require('fs');
    var dest = path.join(outputdir, "swagger.json");

    request.get(argv.url, function (error, response, body) {
        // Download failure, try to read local swagger.json
        if (error || response.statusCode != 200) {
            if (fs.existsSync(dest)) {
                var g = new genRef.Generator(dest, outputdir);
                g.Debug = true;
                g.generateAPIClient();
            }
            else {
                console.log(error);
            }
        }
        else {
            fs.writeFileSync(dest, body, 'utf-8');
            var g = new genRef.Generator(dest, outputdir);
            g.Debug = true;
            g.generateAPIClient();
        }
    });
}
else {
    var g = new genRef.Generator(sourceFile, outputdir);
    g.Debug = true;
    g.generateAPIClient();
}