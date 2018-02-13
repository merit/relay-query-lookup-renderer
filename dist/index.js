'use strict';

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var React = require('react');
var PropTypes = require('prop-types');
var areEqual = require('fbjs/lib/areEqual');
var deepFreeze = require('deep-freeze');

/**
 * @public
 *
 * Orchestrates fetching and rendering data for a single view or view hierarchy:
 * - Fetches the query/variables using the given network implementation.
 * - Normalizes the response(s) to that query, publishing them to the given
 *   store.
 * - Renders the pending/fail/success states with the provided render function.
 * - Subscribes for updates to the root data and re-renders with any changes.
 */
var ReactRelayQueryRenderer = function (_React$Component) {
    _inherits(ReactRelayQueryRenderer, _React$Component);

    function ReactRelayQueryRenderer(props, context) {
        _classCallCheck(this, ReactRelayQueryRenderer);

        var _this = _possibleConstructorReturn(this, (ReactRelayQueryRenderer.__proto__ || Object.getPrototypeOf(ReactRelayQueryRenderer)).call(this, props, context));

        _this._onChange = function (snapshot) {
            _this.setState({
                readyState: _extends({}, _this.state.readyState, {
                    props: snapshot.data
                })
            });
        };

        _this._pendingFetch = null;
        _this._rootSubscription = null;
        _this._selectionReference = null;

        _this.state = {
            readyState: _this._fetchForProps(props)
        };
        return _this;
    }

    _createClass(ReactRelayQueryRenderer, [{
        key: 'componentWillReceiveProps',
        value: function componentWillReceiveProps(nextProps) {
            if (nextProps.query !== this.props.query || nextProps.environment !== this.props.environment || !areEqual(nextProps.variables, this.props.variables)) {
                this.setState({
                    readyState: this._fetchForProps(nextProps)
                });
            }
        }
    }, {
        key: 'componentWillUnmount',
        value: function componentWillUnmount() {
            this._release();
        }
    }, {
        key: 'shouldComponentUpdate',
        value: function shouldComponentUpdate(nextProps, nextState) {
            return nextProps.render !== this.props.render || nextState.readyState !== this.state.readyState;
        }
    }, {
        key: '_release',
        value: function _release() {
            if (this._pendingFetch) {
                this._pendingFetch.dispose();
                this._pendingFetch = null;
            }
            if (!this.props.retain && this._rootSubscription) {
                this._rootSubscription.dispose();
                this._rootSubscription = null;
            }
            if (!this.props.retain && this._selectionReference) {
                this._selectionReference.dispose();
                this._selectionReference = null;
            }
        }
    }, {
        key: '_fetchForProps',
        value: function _fetchForProps(props) {
            var _this2 = this;

            // TODO (#16225453) QueryRenderer works with old and new environment, but
            // the flow typing doesn't quite work abstracted.
            var environment = props.environment;

            var query = props.query,
                variables = props.variables;

            if (query) {
                var _environment$unstable = environment.unstable_internal,
                    createOperationSelector = _environment$unstable.createOperationSelector,
                    getOperation = _environment$unstable.getOperation;

                var operation = createOperationSelector(getOperation(query), variables);
                this._relayContext = {
                    environment: environment,
                    variables: operation.variables
                };
                if (props.lookup && environment.check(operation.root)) {
                    this._selectionReference = environment.retain(operation.root);

                    // data is available in the store, render without making any requests
                    var snapshot = environment.lookup(operation.fragment);
                    this._rootSubscription = environment.subscribe(snapshot, this._onChange);
                    return {
                        error: null,
                        props: snapshot.data,
                        retry: function retry() {
                            _this2._fetch(operation, props.cacheConfig);
                        }
                    };
                } else {
                    return this._fetch(operation, props.cacheConfig) || getDefaultState();
                }
            } else {
                this._relayContext = {
                    environment: environment,
                    variables: variables
                };
                this._release();
                return {
                    error: null,
                    props: {},
                    retry: null
                };
            }
        }
    }, {
        key: '_fetch',
        value: function _fetch(operation, cacheConfig) {
            var _this3 = this;

            var environment = this._relayContext.environment;

            // Immediately retain the results of the new query to prevent relevant data
            // from being freed. This is not strictly required if all new data is
            // fetched in a single step, but is necessary if the network could attempt
            // to incrementally load data (ex: multiple query entries or incrementally
            // loading records from disk cache).

            var nextReference = environment.retain(operation.root);

            var readyState = getDefaultState();
            var snapshot = void 0; // results of the root fragment
            var hasSyncResult = false;
            var hasFunctionReturned = false;

            if (this._pendingFetch) {
                this._pendingFetch.dispose();
            }
            if (this._rootSubscription) {
                this._rootSubscription.dispose();
            }

            var request = environment.execute({ operation: operation, cacheConfig: cacheConfig }).finally(function () {
                _this3._pendingFetch = null;
            }).subscribe({
                next: function next() {
                    // `next` can be called multiple times by network layers that support
                    // data subscriptions. Wait until the first payload to render `props`
                    // and subscribe for data updates.
                    if (snapshot) {
                        return;
                    }
                    snapshot = environment.lookup(operation.fragment);

                    readyState = {
                        error: null,
                        props: snapshot.data,
                        retry: function retry() {
                            // Do not reset the default state if refetching after success,
                            // handling the case where _fetch may return syncronously instead
                            // of calling setState.
                            var syncReadyState = _this3._fetch(operation, cacheConfig);
                            if (syncReadyState) {
                                _this3.setState({ readyState: syncReadyState });
                            }
                        }
                    };

                    if (_this3._selectionReference) {
                        _this3._selectionReference.dispose();
                    }
                    _this3._rootSubscription = environment.subscribe(snapshot, _this3._onChange);
                    _this3._selectionReference = nextReference;
                    // This line should be called only once.
                    hasSyncResult = true;
                    if (hasFunctionReturned) {
                        _this3.setState({ readyState: readyState });
                    }
                },
                error: function (_error) {
                    function error(_x) {
                        return _error.apply(this, arguments);
                    }

                    error.toString = function () {
                        return _error.toString();
                    };

                    return error;
                }(function (error) {
                    readyState = {
                        error: error,
                        props: null,
                        retry: function retry() {
                            // Return to the default state when retrying after an error,
                            // handling the case where _fetch may return syncronously instead
                            // of calling setState.
                            var syncReadyState = _this3._fetch(operation, cacheConfig);
                            _this3.setState({ readyState: syncReadyState || getDefaultState() });
                        }
                    };
                    if (_this3._selectionReference) {
                        _this3._selectionReference.dispose();
                    }
                    _this3._selectionReference = nextReference;
                    hasSyncResult = true;
                    if (hasFunctionReturned) {
                        _this3.setState({ readyState: readyState });
                    }
                })
            });

            this._pendingFetch = {
                dispose: function dispose() {
                    request.unsubscribe();
                    nextReference.dispose();
                }
            };
            hasFunctionReturned = true;
            return hasSyncResult ? readyState : null;
        }
    }, {
        key: 'getChildContext',
        value: function getChildContext() {
            return {
                relay: this._relayContext
            };
        }
    }, {
        key: 'render',
        value: function render() {
            // Note that the root fragment results in `readyState.props` is already
            // frozen by the store; this call is to freeze the readyState object and
            // error property if set.
            // if (__DEV__) {
            //     deepFreeze(this.state.readyState);
            // }
            return this.props.render(this.state.readyState);
        }
    }]);

    return ReactRelayQueryRenderer;
}(React.Component);

ReactRelayQueryRenderer.childContextTypes = {
    relay: PropTypes.object.isRequired
};

function getDefaultState() {
    return {
        error: null,
        props: null,
        retry: null
    };
}

module.exports = ReactRelayQueryRenderer;