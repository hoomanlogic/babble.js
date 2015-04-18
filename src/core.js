/**
 * @module core
 * @description Natural language processing core objects and methods
 */
(function (exports) {
    'use strict';
    
    /**
     * Returns the given object's toString representation
     * if it is defined, otherwise returns the given object.
     * @param {object} The object to get a string if toString exists.
     * @return {string, object} Result of toString or obj is toString does not exist.
     */
    var toStringIfExists = function (obj) {
        if (obj.hasOwnProperty('toString')) {
            return obj.toString();
        } else {
            return obj;   
        }
    };

    /**
     * TODO: Describe this
     */
    var assign = function (name, speaker) {
        var event = null, 
            locale = null, 
            onTranslate = null;
        
        if (arguments.length < 3 || typeof arguments[arguments.length - 1] !== 'function') {
            throw new TypeError('Unexpected number of arguments');   
        }
        
        onTranslate = arguments[arguments.length - 1];
        if (arguments.length > 3) {
            event = arguments[2];
        }
        if (arguments.length > 4) {
            locale = arguments[3];
        }
        
        var translator = get(name, locale);
        //translator.locale = locale; // we have to set it so it doesn't forget
        translator.listen(speaker, event, onTranslate, locale);
    };

    /**
     * Get token closest to current match that is 
     * between the previous and current match.
     * As always, a collection of tokens is assumed 
     * to already be ordered by pos prop.
     */
    var getTokenModifier = function (tokens, match, previousMatch) {

        var lowerBound = 0;
        var upperBound = match.pos;
        if (typeof previousMatch !== 'undefined' && previousMatch !== null) {
            lowerBound = previousMatch.pos + previousMatch.text.length;
        }

        var i = 0,
            token = null;

        for (var i = 0; i < tokens.length; i++) {
            if (lowerBound <= tokens[i].pos && tokens[i].pos < upperBound) {
                token = tokens[i];
            } else if (tokens[i].pos >= upperBound) {
                break;   
            }
        }

        return token;
    };
    
    /**
     * Function keeps the matches in order by the position
     * so processing doesn't have to worry about sorting it
     */
    var insertToken = function (arr, obj) {
        if (arr.length === 0 || arr[arr.length - 1].pos < obj.pos) {
            arr.push(obj);   
        } else {
            for (var i = 0; i < arr.length; i++) {
                if (arr[i].pos > obj.pos) {
                    arr.splice(i, 0, obj);
                    break;
                } else if (arr[i].pos === obj.pos && arr[i].len < obj.len) {
                    arr.splice(i, 1, obj);
                    break;
                }
            }
        }
    };

    /**
     * Create parsed results object and Bind functions to the parsed results for sugar
     */
    var ParsedResult = function (input, tokens, preParsedOutput, preParsedResults) {
        this.input = input;
        this.tokens = tokens;
        this.preParsedOutput = preParsedOutput || null;
        this.preParsedResults = preParsedResults || null;
    };
    
    ParsedResult.prototype = {
        /**
         * This takes any string, locates groups of 
         * spelled out numbers and converts them to digits
         * @return {number} Returns the processed input string.
         */
        digify: function () {
            var input = this.preParsedOutput || this.input;
            for (var i = 0; i < this.tokens.length; i++) {
                input = input.replace(this.tokens[i].text, toStringIfExists(this.tokens[i].value));
            }
            return input;
        }
     };
    
    /**
     * Tokens are the gold nuggets of lexical analysis
     */
    var Token = function (value, kind, pos, text, tokens, certainty) {
        this.value = value;
        this.kind = kind;
        this.pos = pos;
        this.text = text;
        this.tokens = tokens || [];
        this.certainty = certainty || 0;
    }

    var BaseTranslator = function (onTranslate, locale) {

        /**
         * Validate instance
         */ 
        if (
        !this.hasOwnProperty('name') || 
        typeof this.name !== 'string' || 
        !this.hasOwnProperty('parse') || 
        typeof this.parse !== 'function' || 
        this.constructor.toString() === 'function Object() { [native code] }') {
            
            throw new Error('BaseTranslator must be inheritied and properties set for "name" and "parse"');
        }
        
        /**
         * Validate registration
         */ 
        if (typeof translators[this.name] === 'undefined') {
            throw new Error('"' + this.name + '" must be registered before it is instantiated');
        }
        
        /**
         * Validate locale
         */ 
        this.locale = locale || translators[this.name].defaultLocale;
        if (translators[this.name].supportedLocales.indexOf(this.locale) === -1) {
            throw new Error('Locale "' + this.locale + '" is not supported by "' + this.name + '"');
        }
        
        /**
         * Define onTranslate which is called
         * by the listen event
         */ 
        this.onTranslate = onTranslate || null;
        
        /**
         * Define assistants array if derived class
         * has not already defined it
         */ 
        if (!this.hasOwnProperty('assistants')) {
            this.assistants = [];
        }
    };
    
    BaseTranslator.prototype = {
        /**
         * Attaches the translate function to an event listener
         * @param speaker {Element, object, string} 
         */
        listen: function (speaker, event, onTranslate, locale) {
            /**
             * Get object reference to the Element
             * if speaker is a string and document
             * is defined
             */
            if (typeof speaker === 'string' && document && document.getElementById) {
                speaker = document.getElementById(speaker);
            }
            
            /**
             * Default event name to input if not given
             */
            event = event || 'input';
            
            /**
             * Define onTranslate which is called
             * by the listen event
             */
            onTranslate = onTranslate || this.onTranslate;
            
            /**
             * Bind to the input control's oninput event
             */
            if (speaker.addEventListener) {
                speaker.addEventListener(event, this.translate.bind(this, speaker, locale, onTranslate));
            } else if (speaker.attachEvent) {
                speaker.attachEvent('on' + event, this.translate.bind(this, speaker, locale, onTranslate));
            } else if (typeof speaker['on' + event] !== 'undefined') {
                speaker['on' + event] = this.translate.bind(this, speaker, locale, onTranslate);
            } else if (typeof speaker[event] !== 'undefined') {
                speaker[event] = this.translate.bind(this, speaker, locale, onTranslate);
            } else {
                throw new Error('Could not find an appropriate event to bind to');   
            }
        },
        /**
         * Determines accepts multiple arguments and
         * passes appropriate ones to the parse function.
         * Passes the result to callbacks before returning
         * the result. 
         * This can be used directly or by the listen method.
         */
        translate: function () {
            /**
             * Determine the locale
             */
            var localeIndex = arguments.length > 1 ? 1 : 0;
            var locale = this.locale;
            if (translators[this.name].supportedLocales.indexOf(arguments[localeIndex]) !== -1) {
                locale = arguments[localeIndex];
            }
        
            /**
             * Determine the input
             */
            var input = '';
            var inputIndex = arguments.length > 2 ? arguments.length - 1 : localeIndex - 1;
            if (typeof arguments[inputIndex] === 'string') {
                input = arguments[inputIndex];
            } else if (arguments[inputIndex] && arguments[inputIndex].target && arguments[inputIndex].target.value) {
                input = arguments[inputIndex].target.value;
            }

            /**
             * Parse the input, pass to callbacks, and return the result.
             */
            if (input) {
                var result = this.parse(input, locale);
                if (arguments.length > 2 && typeof arguments[2] === 'function') {
                    arguments[2](result, arguments[0]);
                } else if (this.onTranslate && arguments.length > 1 && typeof arguments[0] !== 'string') {
                    this.onTranslate(result, arguments[0]);
                }
                return result;
            }
        },
        /**
         * Passes the input to the translators 
         * assistants and returns parsed results
         */
        passToAssistants: function (input, locale) {
            var preParsedOutput = input, 
                preParsedResults = {};
            for (var i = 0; i < this.assistants.length; i++) {
                preParsedResults[this.assistants[i]] = get(this.assistants[i]).parse(preParsedOutput, locale);
                preParsedOutput = preParsedResults[this.assistants[i]].digify();
            }
            return {
                preParsedOutput: preParsedOutput,
                preParsedResults: preParsedResults
            };
        }
    };
        
    /**
     * Expose classes used by Translator implementations
     */
    exports.ParsedResult = ParsedResult;
    exports.BaseTranslator = BaseTranslator;
    exports.Token = Token;
    
    /**
     * Expose method used for registering translators with
     * the core. passToAssistants uses these singleton
     * instances of each translator.
     */
    var translators = {};
    var register = function (name, instance, defaultLocale, supportedLocales) {
        translators[name] = {
            instance: null,
            defaultLocale: defaultLocale,
            supportedLocales: supportedLocales
        };
        
        translators[name].instance = new instance();
    };
    exports.register = register;
    
    /**
     * Expose method used for getting a singleton instance 
     * of a translator.
     */
    var get = function (name, locale) {
        locale = locale || translators[name].instance.locale;
        if (translators[name].supportedLocales.indexOf(locale) === -1) {
            throw new Error('Locale "' + this.locale + '" is not supported by "' + name + '"');
        }
        
        translators[name].locale = locale || translators[name].instance.locale;
        return translators[name].instance;
    };
    exports.get = get;
    
    exports.assign = assign;

    exports.getTokenModifier = getTokenModifier;
    
    exports.insertToken = insertToken;
    
}(typeof exports === 'undefined' ? this['babble'] = this['babble'] || {}: exports));