/*
 * lib/jsprim.js: utilities for primitive JavaScript types
 */

var mod_assert = require('assert');
var mod_util = require('util');

var mod_extsprintf = require('extsprintf');
var mod_verror = require('verror');
var mod_jsonschema = require('json-schema');

var mod_jsv;		/* lazy-loaded because it may not be here */

/*
 * Public interface
 */
exports.deepCopy = deepCopy;
exports.deepEqual = deepEqual;
exports.isEmpty = isEmpty;
exports.forEachKey = forEachKey;
exports.pluck = pluck;
exports.flattenObject = flattenObject;
exports.flattenIter = flattenIter;
exports.validateJsonObject = validateJsonObjectJS;
exports.validateJsonObjectJS = validateJsonObjectJS;
exports.validateJsonObjectJSV = validateJsonObjectJSV;
exports.randElt = randElt;

exports.startsWith = startsWith;
exports.endsWith = endsWith;

exports.iso8601 = iso8601;
exports.parseDateTime = parseDateTime;


/*
 * Deep copy an acyclic *basic* Javascript object.  This only handles basic
 * scalars (strings, numbers, booleans) and arbitrarily deep arrays and objects
 * containing these.  This does *not* handle instances of other classes.
 */
function deepCopy(obj)
{
	var ret, key;
	var marker = '__deepCopy';

	if (obj && obj[marker])
		throw (new Error('attempted deep copy of cyclic object'));

	if (obj && obj.constructor == Object) {
		ret = {};
		obj[marker] = true;

		for (key in obj) {
			if (key == marker)
				continue;

			ret[key] = deepCopy(obj[key]);
		}

		delete (obj[marker]);
		return (ret);
	}

	if (obj && obj.constructor == Array) {
		ret = [];
		obj[marker] = true;

		for (key = 0; key < obj.length; key++)
			ret.push(deepCopy(obj[key]));

		delete (obj[marker]);
		return (ret);
	}

	/*
	 * It must be a primitive type -- just return it.
	 */
	return (obj);
}

function deepEqual(obj1, obj2)
{
	if (typeof (obj1) != typeof (obj2))
		return (false);

	if (obj1 === null || obj2 === null || typeof (obj1) != 'object')
		return (obj1 === obj2);

	if (obj1.constructor != obj2.constructor)
		return (false);

	var k;
	for (k in obj1) {
		if (!obj2.hasOwnProperty(k))
			return (false);

		if (!deepEqual(obj1[k], obj2[k]))
			return (false);
	}

	for (k in obj2) {
		if (!obj1.hasOwnProperty(k))
			return (false);
	}

	return (true);
}

function isEmpty(obj)
{
	var key;
	for (key in obj)
		return (false);
	return (true);
}

function forEachKey(obj, callback)
{
	for (var key in obj)
		callback(key, obj[key]);
}

function pluck(obj, key)
{
	mod_assert.equal(typeof (key), 'string');
	return (pluckv(obj, key));
}

function pluckv(obj, key)
{
	if (obj === null || typeof (obj) !== 'object')
		return (undefined);

	if (obj.hasOwnProperty(key))
		return (obj[key]);

	var i = key.indexOf('.');
	if (i == -1)
		return (undefined);

	var key1 = key.substr(0, i);
	if (!obj.hasOwnProperty(key1))
		return (undefined);

	return (pluckv(obj[key1], key.substr(i + 1)));
}

/*
 * Invoke callback(row) for each entry in the array that would be returned by
 * flattenObject(data, depth).  This is just like flattenObject(data,
 * depth).forEach(callback), except that the intermediate array is never
 * created.
 */
function flattenIter(data, depth, callback)
{
	doFlattenIter(data, depth, [], callback);
}

function doFlattenIter(data, depth, accum, callback)
{
	var each;
	var key;

	if (depth === 0) {
		each = accum.slice(0);
		each.push(data);
		callback(each);
		return;
	}

	mod_assert.ok(data !== null);
	mod_assert.equal(typeof (data), 'object');
	mod_assert.equal(typeof (depth), 'number');
	mod_assert.ok(depth >= 0);

	for (key in data) {
		each = accum.slice(0);
		each.push(key);
		doFlattenIter(data[key], depth - 1, each, callback);
	}
}

function flattenObject(data, depth)
{
	if (depth === 0)
		return ([ data ]);

	mod_assert.ok(data !== null);
	mod_assert.equal(typeof (data), 'object');
	mod_assert.equal(typeof (depth), 'number');
	mod_assert.ok(depth >= 0);

	var rv = [];
	var key;

	for (key in data) {
		flattenObject(data[key], depth - 1).forEach(function (p) {
			rv.push([ key ].concat(p));
		});
	}

	return (rv);
}

function startsWith(str, prefix)
{
	return (str.substr(0, prefix.length) == prefix);
}

function endsWith(str, suffix)
{
	return (str.substr(
	    str.length - suffix.length, suffix.length) == suffix);
}

function iso8601(d)
{
	if (typeof (d) == 'number')
		d = new Date(d);
	mod_assert.ok(d.constructor === Date);
	return (mod_extsprintf.sprintf('%4d-%02d-%02dT%02d:%02d:%02d.%03dZ',
	    d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(),
	    d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(),
	    d.getUTCMilliseconds()));
}

/*
 * Parses a date expressed as a string, as either a number of milliseconds since
 * the epoch or any string format that Date accepts, giving preference to the
 * former where these two sets overlap (e.g., small numbers).
 */
function parseDateTime(str)
{
	/*
	 * This is irritatingly implicit, but significantly more concise than
	 * alternatives.  The "+str" will convert a string containing only a
	 * number directly to a Number, or NaN for other strings.  Thus, if the
	 * conversion succeeds, we use it (this is the milliseconds-since-epoch
	 * case).  Otherwise, we pass the string directly to the Date
	 * constructor to parse.
	 */
	return (new Date(+str || str));
}

function validateJsonObjectJSV(schema, input)
{
	if (!mod_jsv)
		mod_jsv = require('JSV');

	var env = mod_jsv.JSV.createEnvironment();
	var report = env.validate(input, schema);

	if (report.errors.length === 0)
		return (null);

	/* Currently, we only do anything useful with the first error. */
	mod_assert.ok(report.errors.length > 0);
	var error = report.errors[0];

	/* The failed property is given by a URI with an irrelevant prefix. */
	var propname = error['uri'].substr(error['uri'].indexOf('#') + 2);
	var reason;

	/*
	 * Some of the default error messages are pretty arcane, so we define
	 * new ones here.
	 */
	switch (error['attribute']) {
	case 'type':
		reason = 'expected ' + error['details'];
		break;
	default:
		reason = error['message'].toLowerCase();
		break;
	}

	var message = reason + ': "' + propname + '"';
	var rv = new Error(message);
	rv.jsv_details = error;
	return (rv);
}

function validateJsonObjectJS(schema, input)
{
	var report = mod_jsonschema.validate(input, schema);

	if (report.errors.length === 0)
		return (null);

	/* Currently, we only do anything useful with the first error. */
	var error = report.errors[0];

	/* The failed property is given by a URI with an irrelevant prefix. */
	var propname = error['property'];
	var reason = error['message'].toLowerCase();
	var i, j;

	/*
	 * There's at least one case where the property error message is
	 * confusing at best.  We work around this here.
	 */
	if ((i = reason.indexOf('the property ')) != -1 &&
	    (j = reason.indexOf(' is not defined in the schema and the ' +
	    'schema does not allow additional properties')) != -1) {
		i += 'the property '.length;
		if (propname === '')
			propname = reason.substr(i, j - i);
		else
			propname = propname + '.' + reason.substr(i, j - i);

		reason = 'unsupported property';
	}

	var rv = new mod_verror.VError('property "%s": %s', propname, reason);
	rv.jsv_details = error;
	return (rv);
}

function randElt(arr)
{
	mod_assert.ok(Array.isArray(arr) && arr.length > 0,
	    'randElt argument must be a non-empty array');

	return (arr[Math.floor(Math.random() * arr.length)]);
}
