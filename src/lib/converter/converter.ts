import * as ts from "typescript";
import * as _ts from "../ts-internal";
import * as Path from "path";

import {Application} from "../application";
import {ParameterType} from "../utils/options/declaration";
import {Reflection, Type, ProjectReflection} from "../models/index";
import {Context} from "./context";
import {ConverterComponent, ConverterNodeComponent, ConverterTypeComponent, ITypeTypeConverter, ITypeNodeConverter} from "./components";
import {CompilerHost} from "./utils/compiler-host";
import {Component, Option, ChildableComponent, IComponentClass} from "../utils/component"
import {normalizePath} from "../utils/fs";
import * as _ from 'lodash';

/**
 * Result structure of the [[Converter.convert]] method.
 */
export interface IConverterResult
{
    /**
     * An array containing all errors generated by the TypeScript compiler.
     */
    errors:ts.Diagnostic[];

    /**
     * The resulting project reflection.
     */
    project:ProjectReflection;
}


/**
 * Event callback definition for generic converter events.
 *
 * @see [[Converter.EVENT_BEGIN]]
 * @see [[Converter.EVENT_END]]
 * @see [[Converter.EVENT_RESOLVE_BEGIN]]
 * @see [[Converter.EVENT_RESOLVE_END]]
 */
interface IConverterCallback
{
    /**
     * @param context  The context object describing the current state the converter is in.
     */
    (context:Context):void;
}


/**
 * Event callback definition for events triggered by factories.
 *
 * @see [[Converter.EVENT_FILE_BEGIN]]
 * @see [[Converter.EVENT_CREATE_DECLARATION]]
 * @see [[Converter.EVENT_CREATE_SIGNATURE]]
 * @see [[Converter.EVENT_CREATE_PARAMETER]]
 * @see [[Converter.EVENT_CREATE_TYPE_PARAMETER]]
 * @see [[Converter.EVENT_FUNCTION_IMPLEMENTATION]]
 */
interface IConverterNodeCallback
{
    /**
     * @param context  The context object describing the current state the converter is in.
     * @param reflection  The reflection that is currently processed.
     * @param node  The node that is currently processed if available.
     */
    (context:Context, reflection:Reflection, node?:ts.Node):void;
}


/**
 * Event callback definition for events during the resolving phase.
 *
 * @see [[Converter.EVENT_RESOLVE]]
 */
interface IConverterResolveCallback
{
    /**
     * @param context  The context object describing the current state the converter is in.
     * @param reflection  The reflection that is currently resolved.
     */
    (context:Context, reflection:Reflection):void;
}


/**
 * Compiles source files using TypeScript and converts compiler symbols to reflections.
 */
@Component({name:"converter", internal:true, childClass:ConverterComponent})
export class Converter extends ChildableComponent<Application, ConverterComponent>
{
    /**
     * The human readable name of the project. Used within the templates to set the title of the document.
     */
    @Option({
        name: "name",
        help: "Set the name of the project that will be used in the header of the template."
    })
    name:string;

    @Option({
        name: "externalPattern",
        help: 'Define a pattern for files that should be considered being external.'
    })
    externalPattern:string;

    @Option({
        name: "includeDeclarations",
        help: 'Turn on parsing of .d.ts declaration files.',
        type: ParameterType.Boolean
    })
    includeDeclarations:boolean;

    @Option({
        name: "excludeExternals",
        help: 'Prevent externally resolved TypeScript files from being documented.',
        type: ParameterType.Boolean
    })
    excludeExternals:boolean;

    @Option({
        name: "excludeNotExported",
        help: 'Prevent symbols that are not exported from being documented.',
        type: ParameterType.Boolean
    })
    excludeNotExported:boolean;

    @Option({
        name: "excludePrivate",
        help: 'Ignores private variables and methods',
        type: ParameterType.Boolean
    })
    excludePrivate:boolean;

    private compilerHost:CompilerHost;

    private nodeConverters:{[syntaxKind:number]:ConverterNodeComponent<ts.Node>};

    private typeNodeConverters:ITypeNodeConverter<ts.Type, ts.Node>[];

    private typeTypeConverters:ITypeTypeConverter<ts.Type>[];


    /**
     * General events
     */

    /**
     * Triggered when the converter begins converting a project.
     * The listener should implement [[IConverterCallback]].
     * @event
     */
    static EVENT_BEGIN:string = 'begin';

    /**
     * Triggered when the converter has finished converting a project.
     * The listener should implement [[IConverterCallback]].
     * @event
     */
    static EVENT_END:string = 'end';


    /**
     * Factory events
     */

    /**
     * Triggered when the converter begins converting a source file.
     * The listener should implement [[IConverterNodeCallback]].
     * @event
     */
    static EVENT_FILE_BEGIN:string = 'fileBegin';

    /**
     * Triggered when the converter has created a declaration reflection.
     * The listener should implement [[IConverterNodeCallback]].
     * @event
     */
    static EVENT_CREATE_DECLARATION:string = 'createDeclaration';

    /**
     * Triggered when the converter has created a signature reflection.
     * The listener should implement [[IConverterNodeCallback]].
     * @event
     */
    static EVENT_CREATE_SIGNATURE:string = 'createSignature';

    /**
     * Triggered when the converter has created a parameter reflection.
     * The listener should implement [[IConverterNodeCallback]].
     * @event
     */
    static EVENT_CREATE_PARAMETER:string = 'createParameter';

    /**
     * Triggered when the converter has created a type parameter reflection.
     * The listener should implement [[IConverterNodeCallback]].
     * @event
     */
    static EVENT_CREATE_TYPE_PARAMETER:string = 'createTypeParameter';

    /**
     * Triggered when the converter has found a function implementation.
     * The listener should implement [[IConverterNodeCallback]].
     * @event
     */
    static EVENT_FUNCTION_IMPLEMENTATION:string = 'functionImplementation';


    /**
     * Resolve events
     */

    /**
     * Triggered when the converter begins resolving a project.
     * The listener should implement [[IConverterCallback]].
     * @event
     */
    static EVENT_RESOLVE_BEGIN:string = 'resolveBegin';

    /**
     * Triggered when the converter resolves a reflection.
     * The listener should implement [[IConverterResolveCallback]].
     * @event
     */
    static EVENT_RESOLVE:string = 'resolveReflection';

    /**
     * Triggered when the converter has finished resolving a project.
     * The listener should implement [[IConverterCallback]].
     * @event
     */
    static EVENT_RESOLVE_END:string = 'resolveEnd';



    /**
     * Create a new Converter instance.
     *
     * @param application  The application instance this converter relies on. The application
     *   must expose the settings that should be used and serves as a global logging endpoint.
     */
    initialize() {
        this.compilerHost = new CompilerHost(this);
        this.nodeConverters = {};
        this.typeTypeConverters = [];
        this.typeNodeConverters = [];
    }


    addComponent(name:string, componentClass:IComponentClass<ConverterComponent>):ConverterComponent {
        var component = super.addComponent(name, componentClass);
        if (component instanceof ConverterNodeComponent) {
            this.addNodeConverter(component);
        } else if (component instanceof ConverterTypeComponent) {
            this.addTypeConverter(<ITypeTypeConverter<any>|ITypeNodeConverter<any, any>>component);
        }

        return component;
    }


    private addNodeConverter(converter:ConverterNodeComponent<any>) {
        for (var supports of converter.supports) {
            this.nodeConverters[supports] = converter;
        }
    }


    private addTypeConverter(converter:ITypeTypeConverter<any>|ITypeNodeConverter<any, any>) {
        if ("supportsNode" in converter && "convertNode" in converter) {
            this.typeNodeConverters.push(<ITypeNodeConverter<any, any>>converter);
            this.typeNodeConverters.sort((a, b) => (b.priority || 0) - (a.priority || 0));
        }

        if ("supportsType" in converter && "convertType" in converter) {
            this.typeTypeConverters.push(<ITypeTypeConverter<any>>converter);
            this.typeTypeConverters.sort((a, b) => (b.priority || 0) - (a.priority || 0));
        }
    }


    removeComponent(name:string):ConverterComponent {
        var component = super.removeComponent(name);
        if (component instanceof ConverterNodeComponent) {
            this.removeNodeConverter(component);
        } else if (component instanceof ConverterTypeComponent) {
            this.removeTypeConverter(component);
        }

        return component;
    }


    private removeNodeConverter(converter:ConverterNodeComponent<any>) {
        var converters = this.nodeConverters;
        var keys = _.keys(this.nodeConverters);
        for (var key of keys) {
            if (converters[key] === converter) {
                delete converters[key];
            }
        }
    }


    private removeTypeConverter(converter:ConverterTypeComponent) {
        var index = this.typeNodeConverters.indexOf(<any>converter);
        if (index != -1) {
            this.typeTypeConverters.splice(index, 1);
        }

        index = this.typeNodeConverters.indexOf(<any>converter);
        if (index != -1) {
            this.typeNodeConverters.splice(index, 1);
        }
    }

    removeAllComponents() {
        super.removeAllComponents();

        this.nodeConverters = {};
        this.typeTypeConverters = [];
        this.typeNodeConverters = [];
    }

    /**
     * Compile the given source files and create a project reflection for them.
     *
     * @param fileNames  Array of the file names that should be compiled.
     */
    convert(fileNames:string[]):IConverterResult {
        for (var i = 0, c = fileNames.length; i < c; i++) {
            fileNames[i] = normalizePath(_ts.normalizeSlashes(fileNames[i]));
        }

        var program = ts.createProgram(fileNames, this.application.options.getCompilerOptions(), this.compilerHost);
        var checker = program.getTypeChecker();
        var context = new Context(this, fileNames, checker, program);

        this.trigger(Converter.EVENT_BEGIN, context);

        var errors = this.compile(context);
        var project = this.resolve(context);

        this.trigger(Converter.EVENT_END, context);

        return {
            errors: errors,
            project: project
        }
    }


    /**
     * Analyze the given node and create a suitable reflection.
     *
     * This function checks the kind of the node and delegates to the matching function implementation.
     *
     * @param context  The context object describing the current state the converter is in.
     * @param node     The compiler node that should be analyzed.
     * @return The resulting reflection or NULL.
     */
    convertNode(context:Context, node:ts.Node):Reflection {
        if (context.visitStack.indexOf(node) != -1) {
            return null;
        }

        var oldVisitStack = context.visitStack;
        context.visitStack = oldVisitStack.slice();
        context.visitStack.push(node);

        var result:Reflection;
        if (node.kind in this.nodeConverters) {
            result = this.nodeConverters[node.kind].convert(context, node);
        }

        context.visitStack = oldVisitStack;
        return result;
    }


    /**
     * Convert the given TypeScript type into its TypeDoc type reflection.
     *
     * @param context  The context object describing the current state the converter is in.
     * @param node  The node whose type should be reflected.
     * @param type  The type of the node if already known.
     * @returns The TypeDoc type reflection representing the given node and type.
     */
    convertType(context:Context, node?:ts.Node, type?:ts.Type):Type {
        // Run all node based type conversions
        if (node) {
            type = type || context.getTypeAtLocation(node);

            for (let converter of this.typeNodeConverters) {
                if (converter.supportsNode(context, node, type)) {
                    return converter.convertNode(context, node, type);
                }
            }
        }

        // Run all type based type conversions
        if (type) {
            for (let converter of this.typeTypeConverters) {
                if (converter.supportsType(context, type)) {
                    return converter.convertType(context, type);
                }
            }
        }
    }


    /**
     * Compile the files within the given context and convert the compiler symbols to reflections.
     *
     * @param context  The context object describing the current state the converter is in.
     * @returns An array containing all errors generated by the TypeScript compiler.
     */
    private compile(context:Context):ts.Diagnostic[] {
        var program = context.program;

        program.getSourceFiles().forEach((sourceFile) => {
            this.convertNode(context, sourceFile);
        });
        
        let diagnostics = program.getOptionsDiagnostics();
        if (diagnostics.length) return diagnostics;
        
        diagnostics = program.getSyntacticDiagnostics();
        if (diagnostics.length) return diagnostics;
        
        diagnostics = program.getGlobalDiagnostics();
        if (diagnostics.length) return diagnostics;

        diagnostics = program.getSemanticDiagnostics();
        if (diagnostics.length) return diagnostics;
        
        return [];
    }


    /**
     * Resolve the project within the given context.
     *
     * @param context  The context object describing the current state the converter is in.
     * @returns The final project reflection.
     */
    private resolve(context:Context):ProjectReflection {
        this.trigger(Converter.EVENT_RESOLVE_BEGIN, context);
        var project = context.project;

        for (var id in project.reflections) {
            if (!project.reflections.hasOwnProperty(id)) continue;
            this.trigger(Converter.EVENT_RESOLVE, context, project.reflections[id]);
        }

        this.trigger(Converter.EVENT_RESOLVE_END, context);
        return project;
    }


    /**
     * Return the basename of the default library that should be used.
     *
     * @returns The basename of the default library.
     */
    getDefaultLib():string {
        return ts.getDefaultLibFileName(this.application.options.getCompilerOptions());
    }
}
