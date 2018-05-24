'use strict';

var fs = require('fs');
var Mustache = require('mustache');
var _ = require('lodash');

var Generator = (function () {

    function Generator(swaggerfile, outputpath) {
        this._swaggerfile = swaggerfile;
        this._outputPath = outputpath;
    }

    Generator.prototype.Debug = false;

    Generator.prototype.initialize = function () {
        this.LogMessage('Reading Swagger file', this._swaggerfile);
        var swaggerfilecontent = fs.readFileSync(this._swaggerfile, 'UTF-8');

        this.LogMessage('Parsing Swagger JSON');
        this.swaggerParsed = JSON.parse(swaggerfilecontent);

        this.LogMessage('Reading Mustache templates');

        this.templates = {
            'class': fs.readFileSync(__dirname + '/../templates/angular2-service.mustache', 'utf-8'),
            'model': fs.readFileSync(__dirname + '/../templates/angular2-model.mustache', 'utf-8'),
            'models_export': fs.readFileSync(__dirname + '/../templates/angular2-models-export.mustache', 'utf-8')
        };

        this.LogMessage('Creating Mustache viewModel');
        this.viewModel = this.createMustacheViewModel();

        this.initialized = true;
    };

    Generator.prototype.generateAPIClient = function () {
        if (this.initialized !== true) {
            this.initialize();
        }

        this.generateClient();
        this.generateModels();
        this.generateCommonModelsExportDefinition();

        this.LogMessage('API client generated successfully');
    };

    Generator.prototype.generateClient = function () {
        if (this.initialized !== true) {
            this.initialize();
        }

        // generate main API client class
        this.LogMessage('Rendering template for API');
        var result = this.renderLintAndBeautify(this.templates.class, this.viewModel, this.templates);

        var outfile = this._outputPath + '/' + 'index.ts';
        this.LogMessage('Creating output file', outfile);
        fs.writeFileSync(outfile, result, 'utf-8')
    };

    Generator.prototype.generateModels = function () {
        var that = this;

        if (this.initialized !== true) {
            this.initialize();
        }

        var outputdir = this._outputPath + '/models';

        if (!fs.existsSync(outputdir)) {
            fs.mkdirSync(outputdir);
        }

        // generate API models

        _.forEach(this.viewModel.definitions, function (definition) {
            that.LogMessage('Rendering template for model ', definition.name);
            var result = that.renderLintAndBeautify(that.templates.model, definition, that.templates);

            var outfile = outputdir + '/' + definition.name.toLowerCase() + '.model.ts';

            that.LogMessage('Creating output file', outfile);
            fs.writeFileSync(outfile, result, 'utf-8')
        });
    };

    Generator.prototype.generateCommonModelsExportDefinition = function () {
        if (this.initialized !== true) {
            this.initialize();
        }

        var outputdir = this._outputPath;

        if (!fs.existsSync(outputdir)) {
            fs.mkdirSync(outputdir);
        }

        this.LogMessage('Rendering common models export');
        var result = this.renderLintAndBeautify(this.templates.models_export, this.viewModel, this.templates);

        var outfile = outputdir + '/models.ts';

        this.LogMessage('Creating output file', outfile);
        fs.writeFileSync(outfile, result, 'utf-8')
    };

    Generator.prototype.renderLintAndBeautify = function (template, model) {
        return Mustache.render(template, model);
    };

    Generator.prototype.createMustacheViewModel = function () {
        var that = this;
        var swagger = this.swaggerParsed;
        var authorizedMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
        var data = {
            isNode: false,
            description: swagger.info.description,
            isSecure: swagger.securityDefinitions !== undefined,
            swagger: swagger,
            domain: (swagger.schemes && swagger.schemes.length > 0 ? swagger.schemes[0] : 'http') + '://' +
                (swagger.host ? swagger.host : 'localhost') + ('/' === swagger.basePath ? '' : swagger.basePath),
            methods: [],
            enums: [],
            definitions: []
        };

        _.forEach(swagger.paths, function (api, path) {
            var globalParams = [];
            debugger;
            _.forEach(api, function (op, m) {
                if (m.toLowerCase() === 'parameters') {
                    globalParams = op;
                }
            });

            _.forEach(api, function (op, m) {
                if (authorizedMethods.indexOf(m.toUpperCase()) === -1) {
                    return;
                }

                // The description line is optional in the spec
                var summaryLines = [];
                if (op.description) {
                    summaryLines = op.description.split('\n');
                    summaryLines.splice(summaryLines.length - 1, 1);
                }

                var method = {
                    path: path,
                    backTickPath: path.replace(/(\{.*?\})/g, '$$$1'),
                    methodName: op['x-swagger-js-method-name'] ? op['x-swagger-js-method-name'] : (op.operationId ? op.operationId : that.getPathToMethodName(m, path)),
                    method: m.toUpperCase(),
                    angular2httpMethod: m.toLowerCase(),
                    isGET: m.toUpperCase() === 'GET',
                    hasPayload: !_.includes(['GET', 'DELETE', 'HEAD'], m.toUpperCase()),
                    summaryLines: summaryLines,
                    isSecure: swagger.security !== undefined || op.security !== undefined,
                    parameters: [],
                    hasQueryParameters: false,
                    hasHeaderParameters: false,
                    hasJsonResponse: _.some(_.defaults([], swagger.produces, op.produces), function (response) { // TODO PREROBIT
                        return response.indexOf('/json') != -1;
                    })
                };

                var params = [];

                if (_.isArray(op.parameters)) {
                    params = op.parameters;
                }

                params = params.concat(globalParams);

                // Index file!
                _.forEach(params, function (parameter) {
                    // Ignore headers which are injected by proxies & app servers
                    // eg: https://cloud.google.com/appengine/docs/go/requests#Go_Request_headers
                    if (parameter['x-proxy-header'] && !data.isNode) {
                        return;
                    }

                    if (_.has(parameter, 'schema') && _.isString(parameter.schema.$ref)) {
                        parameter.type = that.camelCase(that.getRefType(parameter.schema.$ref));
                    }

                    parameter.camelCaseName = that.camelCase(parameter.name);

                    // lets also check for a bunch of Java objects!
                    if (parameter.type === 'integer' || parameter.type === 'double' || parameter.type == 'Integer') {
                        parameter.typescriptType = 'number';
                    } else if (parameter.type == 'String') {
                        parameter.typescriptType = 'string';
                    } else if (parameter.type == 'Boolean') {
                        parameter.typescriptType = 'boolean';
                    } else if (parameter.type === 'object') {
                        parameter.typescriptType = 'any';
                    } else if (parameter.type === 'array') {
                        parameter.typescriptType = that.camelCase(parameter.items['type']) +'[]';
                    } else {
                        parameter.typescriptType = that.camelCase(parameter.type);
                    }

                    if (parameter.enum) {
                        if (parameter.enum.length === 1) {
                            parameter.isSingleton = true;
                            parameter.singleton = parameter.enum[0];
                        } else if (parameter.type === 'string') {
                            var enumeration = {
                                name: null,
                                values: []
                            }

                            // upper keyword to templates
                            enumeration.upper = function() {
                                return function (text, render) {
                                    return render(text).toUpperCase();
                                }
                            };

                            enumeration.name = parameter.name[0].toUpperCase() + parameter.name.substring(1);
                            var addEnum = true;
                            for (var i = 0; i < data.enums.length; i++) {
                                if (data.enums[i].name === enumeration.name) {
                                    addEnum = false;
                                }
                            }
                            if (addEnum) {
                                for (var i = 0; i < parameter.enum.length; i++) {
                                    var value = {value: parameter.enum[i], isLast: i === parameter.enum.length - 1};
                                    enumeration.values.push(value);
                                }
                                data.enums.push(enumeration);
                            }
                            parameter.typescriptType = enumeration.name;
                        }
                    }

                    if (parameter.in === 'body') {
                        parameter.isBodyParameter = true;
                        method.hasBodyParameters = true;
                    } else if (parameter.in === 'path') {
                        parameter.isPathParameter = true;
                    } else if (parameter.in === 'query' || parameter.in === 'modelbinding') {
                        parameter.isQueryParameter = true;
                        if (parameter['x-name-pattern']) {
                            parameter.isPatternType = true;
                        }
                        method.hasQueryParameters = true;
                    } else if (parameter.in === 'header') {
                        parameter.isHeaderParameter = true;
                        method.hasHeaderParameters = true;
                    } else if (parameter.in === 'formData') {
                        parameter.isFormParameter = true;
                    }

                    method.parameters.push(parameter);
                });

                if (method.parameters.length > 0) {
                    method.parameters[method.parameters.length - 1].isLast = true;
                }

                if (op.responses['200'] != undefined) {
                    var responseSchema = op.responses['200'].schema;

                    if (_.has(responseSchema, 'type')) {
                        if (responseSchema['type'] === 'array') {
                            var items = responseSchema.items;
                            if (_.has(items, '$ref')) {
                              method.response = that.camelCase(items['$ref'].replace('#/definitions/', '')) + '[]';
                            } else {
                                method.response = that.camelCase(items['type']) + '[]';
                            }
                        } else {
                            method.response = 'any';
                        }
                    } else if (_.has(responseSchema, '$ref')) {
                        method.response = that.camelCase(responseSchema['$ref'].replace('#/definitions/', ''));
                    } else {
                        method.response = 'any';
                    }
                } else { // check non-200 response codes
                    method.response = 'any';
                }

                data.methods.push(method);
            });
        });

        _.forEach(swagger.definitions, function (defin, defVal) {
            var defName = that.camelCase(defVal);

            var definition = {
                name: defName,
                isLast: false,
                hasEnums: false,
                enums: [],
                properties: [],
                refs: [],
                imports: []
            };

            // lower keyword to templates
            definition.lower = function() {
                return function (text, render) {
                    return render(text).toLowerCase();
                }
            };

            _.forEach(defin.properties, function (propin, propVal) {
                var property = {
                    name: propVal,
                    isRef: _.has(propin, '$ref') || (propin.type === 'array' && _.has(propin.items, '$ref')),
                    isArray: propin.type === 'array',
                    isEnum: propin.enum,
                    type: null,
                    typescriptType: null
                };

                var enumeration = {
                    name: null,
                    values: []
                };

                // upper keyword to templates
                enumeration.upper = function() {
                    return function (text, render) {
                        return render(text).toUpperCase();
                    }
                };

                if (property.isArray) {
                    if (_.has(propin.items, '$ref')) {
                        property.type = that.camelCase(propin.items['$ref'].replace('#/definitions/', ''));
                    } else if (_.has(propin.items, 'type')) {
                        property.type = that.camelCase(propin.items['type']);
                    } else {
                        property.type = propin.type;
                    }
                } else if (property.isEnum) {
                    property.type = property.name[0].toUpperCase() + property.name.substring(1);
                    enumeration.name = property.type;
                    for (var i = 0; i < propin.enum.length; i++) {
                        var value = {value: propin.enum[i], isLast: i === propin.enum.length - 1};
                        enumeration.values.push(value);
                    }
                    definition.enums.push(enumeration);
                    definition.hasEnums = true;

                    if (data.enums.length > 0) {
                        for (var i = 0; i < data.enums.length; i++) {
                            if (data.enums[i].name === enumeration.name) {
                                data.enums.splice(i, 1);
                                break;
                            }
                        }
                    }
                }
                else {
                    property.type = _.has(propin, '$ref') ? that.camelCase(propin['$ref'].replace('#/definitions/', '')) : propin.type;
                }

                if (property.type === 'integer' || property.type === 'double') {
                    property.typescriptType = 'number';
                } else if (property.type === 'object') {
                    property.typescriptType = 'any';
                } else {
                    property.typescriptType = property.type;
                }

                if (property.isRef) {
                    definition.refs.push(property);

                    // Don't duplicate import statements
                    var addImport = true;
                    for (var i = 0; i < definition.imports.length; i++) {
                        if (definition.imports[i] === property.type) {
                            addImport = false;
                        }
                    }
                    if (addImport) {
                        definition.imports.push(property.type);
                    }
                }
                else {
                    definition.properties.push(property);
                }
            });

            _.forEach(defin.allOf, function (oneOf, ofVal) {
                _.forEach(oneOf.properties, function (propin, propVal) {
                    var property = {
                        name: propVal,
                        isRef: _.has(propin, '$ref') || (propin.type === 'array' && _.has(propin.items, '$ref')),
                        isArray: propin.type === 'array',
                        isEnum: propin.enum,
                        type: null,
                        typescriptType: null
                    };

                    var enumeration = {
                        name: null,
                        values: []
                    };

                    // upper keyword to templates
                    enumeration.upper = function() {
                        return function (text, render) {
                            return render(text).toUpperCase();
                        }
                    };

                    if (property.isArray) {
                        if (_.has(propin.items, '$ref')) {
                            property.type = that.camelCase(propin.items['$ref'].replace('#/definitions/', ''));
                        } else if (_.has(propin.items, 'type')) {
                            property.type = that.camelCase(propin.items['type']);
                        } else {
                            property.type = propin.type;
                        }
                    } else if (property.isEnum) {
                        property.type = property.name[0].toUpperCase() + property.name.substring(1);
                        enumeration.name = property.type;
                        for (var i = 0; i < propin.enum.length; i++) {
                            var value = {value: propin.enum[i], isLast: i === propin.enum.length - 1};
                            enumeration.values.push(value);
                        }
                        definition.enums.push(enumeration);
                        definition.hasEnums = true;

                        if (data.enums.length > 0) {
                            for (var i = 0; i < data.enums.length; i++) {
                                if (data.enums[i].name === enumeration.name) {
                                    data.enums.splice(i, 1);
                                    break;
                                }
                            }
                        }
                    }
                    else {
                        property.type = _.has(propin, '$ref') ? that.camelCase(propin['$ref'].replace('#/definitions/', '')) : propin.type;
                    }

                    if (property.type === 'integer' || property.type === 'double') {
                        property.typescriptType = 'number';
                    } else if (property.type === 'object') {
                        property.typescriptType = 'any';
                    } else {
                        property.typescriptType = property.type;
                    }

                    if (property.isRef) {
                        definition.refs.push(property);

                        // Don't duplicate import statements
                        var addImport = true;
                        for (var i = 0; i < definition.imports.length; i++) {
                            if (definition.imports[i] === property.type) {
                                addImport = false;
                            }
                        }
                        if (addImport) {
                            definition.imports.push(property.type);
                        }
                    }
                    else {
                        definition.properties.push(property);
                    }
                });
            });

            data.definitions.push(definition);
        });

        if (data.definitions.length > 0) {
            data.definitions[data.definitions.length - 1].isLast = true;
        }

        return data;
    };

    Generator.prototype.getRefType = function (refString) {
        var segments = refString.split('/');
        return segments.length === 3 ? segments[2] : segments[0];
    };

    Generator.prototype.getPathToMethodName = function (m, path) {
        if (path === '/' || path === '') {
            return m;
        }

        // clean url path for requests ending with '/'
        var cleanPath = path;

        if (cleanPath.indexOf('/', cleanPath.length - 1) !== -1) {
            cleanPath = cleanPath.substring(0, cleanPath.length - 1);
        }

        var segments = cleanPath.split('/').slice(1);

        segments = _.transform(segments, function (result, segment) {
            if (segment[0] === '{' && segment[segment.length - 1] === '}') {
                segment = 'by' + segment[1].toUpperCase() + segment.substring(2, segment.length - 1);
            }

            result.push(segment);
        });

        var result = this.camelCase(segments.join('-'));

        return m.toLowerCase() + result[0].toUpperCase() + result.substring(1);
    };

    Generator.prototype.camelCase = function (text) {
        if (!text) {
            return text;
        }

        if (text.indexOf('-') === -1 && text.indexOf('.') === -1) {
            return text;
        }

        var tokens = [];

        text.split('-').forEach(function (token, index) {
            tokens.push((index > 0 ? token[0].toUpperCase() : token[0]) + token.substring(1));
        });

        var partialres = tokens.join('');
        tokens = [];

        partialres.split('.').forEach(function (token, index) {
            tokens.push((index > 0 ? token[0].toUpperCase() : token[0]) + token.substring(1));
        });

        return tokens.join('');
    };

    Generator.prototype.LogMessage = function (text, param) {
        if (this.Debug) {
            console.log(text, param || '');
        }
    };

    return Generator;
})();

module.exports.Generator = Generator;