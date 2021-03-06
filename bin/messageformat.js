#!/usr/bin/env node

var nopt = require("nopt")
  fs            = require('fs'),
  vm            = require('vm'),
  coffee        = require('coffee-script'), /* only for watchr */
  watch         = require('watchr').watch,
  Path          = require('path'),
  join          = Path.join,
  glob          = require("glob"),
  async         = require('async'),
  MessageFormat = require('../'),
  _             = require('underscore'),
  knownOpts = {
    "locale"    : String,
    "inputdir"  : Path,
    "output"    : Path,
    "combine"   : String,
    "watch"     : Boolean,
    "namespace" : String,
    "include"   : String,
    "stdout"    : Boolean,
    "verbose"   : Boolean
  },
  description = {
    "locale"    : "locale to use [mandatory]",
    "inputdir"  : "directory containing messageformat files to compile",
    "output"    : "output where messageformat will be compiled",
    "combine"   : "combines multiple input files to the provided namespace array element",
    "watch"     : "watch `inputdir` for change",
    "namespace" : "object in the browser containing the templates",
    "include"   : "Glob patterns for files to include in `inputdir`",
    "stdout"    : "Print the result in stdout instead of writing in a file",
    "verbose"   : "Print logs for debug"
  },
  defaults = {
    "inputdir"  : process.cwd(),
    "output"    : process.cwd(),
    "combine"   : undefined,
    "watch"     : false,
    "namespace" : 'window.i18n',
    "include"   : '**/*.json',
    "stdout"    : false,
    "verbose"   : false
  },
  shortHands = {
    "l"  : "--locale",
    "i"  : "--inputdir",
    "o"  : "--output",
    "c"  : "--combine",
    "w"  : "--watch",
    "ns" : "--namespace",
    "I"  : "--include",
    "s"  : "--stdout",
    "v"  : "--verbose"
  },
  options = nopt(knownOpts, shortHands, process.argv, 2),
  argvRemain = options.argv.remain,
  inputdir;

// defaults value
_(defaults).forEach(function(value, key){
    options[key] = options[key] || value;
})


if(argvRemain && argvRemain.length >=1 ) options.inputdir = argvRemain[0];
if(argvRemain && argvRemain.length >=2 ) options.output = argvRemain[1];

if(!options.locale) {
  console.error('Usage: messageformat -l [locale] [INPUT_DIR] [OUTPUT_DIR]')
  console.error('')
  //console.error(nopt(knownOpts, shortHands, description, defaults));
  process.exit(-1);
}

var inputdir = options.inputdir;

compile();
if(options.watch){
  return watch(options.inputdir, _.debounce(compile, 100));
}


function handleError( err, data ){
  if(err){
    err = err.message ? err.message : err;
    return console.error('--->\t'+ err);
  }
}

function compile(){
  build(inputdir, options, function(err, data){
    if( err ) return handleError( err );
    write(data, function(err, output){
      if( err ) return handleError( err );
      if( options.verbose ) console.log(output + " written.");
    })
  });
}

function write( data, callback ){
  data = data.join('\n');
  if(options.stdout) {
    return console.log(data);
  }
  var output = options.output;
  fs.stat(output, function(err, stat){
    if(err){
      // do nothing
    }else if(stat.isFile()){
      // do nothing
    }else if(stat.isDirectory()){
      // if `output` is a directory, create a new file called `i18n.js` in this directory.
      output = join(output, 'i18n.js');
    }else{
      return engines.handleError(ouput, 'is not a file nor a directory');
    }

    fs.writeFile( output, data, 'utf8', function( err ){
      if( typeof callback == "function" ) callback(err, output);
    });
  });
};



function build(inputdir, options, callback){
  // arrays of compiled templates
  var compiledMessageFormat = [];

  var mf = new MessageFormat(options.locale, false, options.namespace.replace(/^window\./, ''));

  if( options.verbose ) { console.log('Read dir: ' + inputdir); }
  // list each file in inputdir folder and subfolders
  glob(options.include, {cwd: inputdir}, function(err, files){
    files = files.map(function(file){
      // normalize the file name
      return file.replace(inputdir, '').replace(/^\//, '');
    })

    async.forEach(files, readFile, function(err){
      // errors are logged in readFile. No need to print them here.
      var fileData = ['(function(G){G[\'' + mf.globalName + '\']=' + mf.functions()]
        .concat(compiledMessageFormat)
        .concat(['})(this);']);
      return callback(null, _.flatten(fileData));
    });

    // Read each file, compile them, and append the result in the `compiledI18n` array
    function readFile(file, cb){
      var path = join(inputdir, file);
      fs.stat(path, function(err, stat){
        if(err) { handleError(err); return  cb(); }
        if(!stat.isFile()) {
          if( options.verbose ) { handleError('Skip ' + file); }
          return cb();
        }

        fs.readFile(path, 'utf8', function(err, text){
          if(err) { handleError(err); return cb() }

          var nm = join(file).split('.')[0].replace(/\\/g, '/'); // windows users should have the same key.

          if(options.combine !== undefined) {
            nm = options.combine;
            if( options.verbose ) console.log('Adding to ' + mf.globalName + '["' + nm + '"]');
          }
          else {
            if( options.verbose ) console.log('Building ' + mf.globalName + '["' + nm + '"]');
          }

          compiledMessageFormat.push(compiler( mf, nm, JSON.parse(text) ));
          cb();
        });
      });
    }
  });
}

function compiler(mf, nm, obj){
  var cmf = [mf.globalName + '["' + nm + '"] = {'];

  _(obj).forEach(function(value, key){
    var str = mf.precompile( mf.parse(value) );
    cmf.push(JSON.stringify(key) + ':' + str + ',');
  });
  cmf[cmf.length-1] = cmf[cmf.length-1].replace(/,$/, '}');
  return cmf;
}
