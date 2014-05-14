/*
 * grunt-iis
 * https://github.com/Integrify/node-iis
 *
 * Copyright (c) 2013 Eduardo Pacheco
 * Licensed under the MIT license.
 */

module.exports = function (grunt) {

    'use strict';

    var path = require('path');
    var xml2js = require('xml2js');
    var _ = require('underscore');
    var shell = require('shelljs');

    var appcmd = '%windir%\\system32\\inetsrv\\appcmd.exe';

    var exec = function (cmd, cb) {
        var output = shell.exec(cmd, {
            silent: true
        }).output;
        if (cb) {
            cb(output);
        }
    };

    var App = {
        create: {
            pool: function (options, cb) {
                App.get('apppool', 'APPPOOL.NAME', options.pool, function (pool) {
                    if (!pool) {

                        var cmd = appcmd + ' add apppool /name:"' + options.pool + '" /managedRuntimeVersion:"' + options.managedRuntimeVersion + '"';
                        exec(cmd, function (output) {
                            if (cb) {
                                App.get('apppool', 'APPPOOL.NAME', options.pool, function (pool) {
                                    pool.created = true;
                                    pool.result = output;
                                    cb(pool);
                                });
                            }
                        });
                    } else {
                        if (cb) {
                            cb(pool);
                        }
                    }
                });
            },
            site: function (options, cb) {
                App.get('site', 'SITE.NAME', options.site, function (site) {
                    if (!site) {

                        var site_cmd = appcmd + ' add site /name:"' + options.site + '"';
                        if (options.binding) {
                            site_cmd += ' /bindings:' + options.binding;
                        }

                        exec(site_cmd, function (output) {
                            if (cb) {
                                App.get('site', 'SITE.NAME', options.site, function (site) {
                                    if (site) {
                                        site.created = true;
                                        site.result = output;

                                        // add SSL certificate to binding
                                        var protocol = site.bindings.substring(0, site.bindings.indexOf('/'));
                                        if (protocol === 'https' && options.cert) {
                                            var port = site.bindings.substring(site.bindings.indexOf(':')+1, site.bindings.length-1);

                                            exec('netsh http add sslcert ipport=0.0.0.0:' + port + ' certhash=' + options.cert + ' appid={ab3c58f7-8316-42e3-bc6e-771d4ce4b201}', function (output) {
                                                site.certAdded = true;
                                                site.result += output;
                                                cb(site);
                                            });
                                        } else {
                                            cb(site);
                                        }
                                    } else {
                                        cb();
                                    }
                                });
                            }
                        });
                    } else {
                        if (cb) {
                            cb(site);
                        }
                    }
                });
            },
            app: function (options, cb) {
                App.get('app', 'path', options.path, function (app) {
                    if (!app) {

                        var cmd = appcmd + ' add app /site.name:"' + options.site + '" /path:"/' + options.path + '/" /physicalPath:"' + options.physicalPath + '" /applicationPool:"' + options.pool + '"';

                        exec(cmd, function (output) {
                            if (cb) {
                                App.get('app', 'path', options.path, function (app) {
                                    if (app) {
                                        app.created = true;
                                        app.result = output;
                                        cb(app);
                                    }
                                });
                            }
                        });
                    } else {
                        App.update.vdir(app, options, function (app) {
                            if (cb) {
                                cb(app);
                            }
                        });
                    }
                });
            }
        },
        update: {
            vdir: function (app, options, cb) {
                var cmd = appcmd + ' set vdir "' + options.site + '/' + options.path + '/" -physicalPath:"' + options.physicalPath + '"';
                exec(cmd, function (output) {
                    if (cb) {
                        App.get('app', 'path', options.path, function (app) {
                            app.vdir_updated = true;
                            app.result = output;
                            cb(app);
                        });
                    }
                });
            }
        },
        get: function (type, key, value, cb) {
            App.list(type, function (err, res) {
                var match = null;
                if (!err) {
                    match = _.find(res, function (v) {
                        var m = v[key];
                        return m && m.replace('/', '').toLowerCase() === value.toLowerCase();
                    });
                }
                cb(match);
            });
        },
        list: function (type, cb) {
            var parser = new xml2js.Parser();
            exec(appcmd + ' list ' + type + ' /xml', function (outxml) {
                parser.parseString(outxml, function (err, result) {

                    var mapped = _.isArray(result[type.toUpperCase()]) ? _.map(result[type.toUpperCase()], function (v) {
                        return v['@'];
                    }) : [result[type.toUpperCase()]['@']];

                    if (cb) {
                        cb(err, mapped);
                    }
                });
            });
        }
    };

    grunt.registerMultiTask('iis', 'IIS Environment Installer for grunt', function () {

        var options = {};
        options.site = this.data.site || 'Default Web Site';
        options.binding = this.data.binding || ((this.data.protocol && this.data.host && this.data.port) ? (this.data.protocol + '://' + this.data.host + ':' + this.data.port) : 'http://*:80');
        options.cert = this.data.cert;
        options.path = this.data.path || '/';
        options.pool = this.data.pool || options.path.replace(/\//g, "_");
        options.managedRuntimeVersion = this.data.managedRuntimeVersion || 'v4.0';
        options.physicalPath = this.data.physicalPath || path.dirname(__dirname);

        App.create.pool(options, function (pool) {
            if (pool && pool.created) {
                console.info(pool.result);
            } else {
                console.info('Apppool already exists.');
            }
            App.create.site(options, function (site) {
                if (site && site.created) {
                    if (site.certAdded) { 
                        console.info(site.result);
                    } else {
                        console.info(site.result);
                    }
                    // create default app if requested path not the default
                    if (options.path !== '/') {
                        var defaultOptions = {
                            site: options.site,
                            path: '/',
                            pool: options.pool,
                            physicalPath: options.physicalPath
                        };
                        App.create.app(defaultOptions, function (app) {
                            console.info(app.result);
                        });
                    }
                } else {
                    console.info('Site already exists.');
                }
                if (options.path) {
                    App.create.app(options, function (app) {
                        if (app && app.created) {
                            console.info('App created. ' + app.result);
                        } else {
                            console.info('App already exists.');
                        }
                    });
                }
            });
        });
    });

};
