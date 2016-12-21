var TypeDoc = require("../index.js");
var Path    = require("path");
var Assert  = require("assert");

describe('TypeDoc', function() {
    var application, parser;

    describe('Application', function() {
        it('constructs', function() {
            application = new TypeDoc.Application();
        });
        it('expands input files', function() {
            var inputFiles = Path.join(__dirname, 'converter', 'class');
            var expanded = application.expandInputFiles([inputFiles]);

            Assert.notEqual(expanded.indexOf(Path.join(inputFiles, 'class.ts')), -1);
            Assert.equal(expanded.indexOf(inputFiles), -1);
        });
        it('enabled verbose mode when passed in as an option', function() {
            application.bootstrap();
            
        });
        it('does not log verbose logs in non verbose mode', function() {
            //assert 'Command line options parsed as:' doesn't happen
            //assert 'Input files parsed as:' doesn't happen 
            //assert 'Converting these files:' doesn't happen
        });        
    });
});
