/**
 * Module Dependencies
 */

var async = require('async');
var _ = require('lodash');
var usageError = require('../../utils/usageError');
var utils = require('../../utils/helpers');
var normalize = require('../../utils/normalize');
var Deferred = require('../deferred');
var callbacks = require('../../utils/callbacksRunner');
var nestedOperations = require('../../utils/nestedOperations');
var hasOwnProperty = utils.object.hasOwnProperty;


/**
 * Update all records matching criteria
 *
 * @param {Object} criteria
 * @param {Object} values
 * @param {Function} cb
 * @return Deferred object if no callback
 */

module.exports = function(criteria, values, cb) {

  var self = this;

  if(typeof criteria === 'function') {
    cb = criteria;
    criteria = null;
  }

  // Return Deferred or pass to adapter
  if(typeof cb !== 'function') {
    return new Deferred(this, this.update, criteria, values);
  }

  // Ensure proper function signature
  var usage = utils.capitalize(this.identity) + '.update(criteria, values, callback)';
  if(!values) return usageError('No updated values specified!', usage, cb);

  // Format Criteria and Values
  var valuesObject = prepareArguments.call(this, criteria, values);

  beforeCallbacks.call(self, valuesObject.values, function(err) {
    if(err) return cb(err);
    updateRecords.call(self, valuesObject, cb);
  });
};


/**
 * Prepare Arguments
 *
 * @param {Object} criteria
 * @param {Object} values
 * @return {Object}
 */

function prepareArguments(criteria, values) {

  // Check if options is an integer or string and normalize criteria
  // to object, using the specified primary key field.
  criteria = normalize.expandPK(this, criteria);

  // Normalize criteria
  criteria = normalize.criteria(criteria);

  // Pull out any associations in the values
  var _values = _.cloneDeep(values);
  var associations = nestedOperations.valuesParser.call(this, this.identity, this.waterline.schema, values);

  // Cast values to proper types (handle numbers as strings)
  values = this._cast.run(values);

  return {
    criteria: criteria,
    values: values,
    originalValues: _values,
    associations: associations
  };
}

/**
 * Run Before* Lifecycle Callbacks
 *
 * @param {Object} values
 * @param {Function} cb
 */

function beforeCallbacks(values, cb) {
  var self = this;

  async.series([

    // Run Validation with Validation LifeCycle Callbacks
    function(cb) {
      callbacks.validate(self, values, true, cb);
    },

    // Before Update Lifecycle Callback
    function(cb) {
      callbacks.beforeUpdate(self, values, cb);
    }

  ], cb);
}

/**
 * Update Records
 *
 * @param {Object} valuesObjecy
 * @param {Function} cb
 */

function updateRecords(valuesObject, cb) {
  var self = this;

  // Automatically change updatedAt (if enabled)
  if(this.autoUpdatedAt) {
    valuesObject.values.updatedAt = new Date();
  }

  // Transform Values
  valuesObject.values = this._transformer.serialize(valuesObject.values);

  // Clean attributes
  valuesObject.values = this._schema.cleanValues(valuesObject.values);

  // Transform Search Criteria
  valuesObject.criteria = self._transformer.serialize(valuesObject.criteria);

  // Pass to adapter
  self.adapter.update(valuesObject.criteria, valuesObject.values, function(err, values) {
    if (err) {
      if (typeof err === 'object') { err.model = self._model.globalId; }
      return cb(err);
    }

    // If values is not an array, return an array
    if(!Array.isArray(values)) values = [values];

    // Unserialize each value
    var transformedValues = values.map(function(value) {
      return self._transformer.unserialize(value);
    });

    // Update any nested associations and run afterUpdate lifecycle callbacks for each parent
    updatedNestedAssociations.call(self, valuesObject, transformedValues, function(err) {
      async.each(transformedValues, function(record, callback) {
        callbacks.afterUpdate(self, record, callback);
      }, function(err) {
        if(err) return cb(err);

        var models = transformedValues.map(function(value) {
          return new self._model(value);
        });

        cb(null, models);
      });
    });

  });
}

/**
 * Update Nested Associations
 *
 * @param {Object} valuesObject
 * @param {Object} values
 * @param {Function} cb
 */

function updatedNestedAssociations(valuesObject, values, cb) {

  var self = this;
  var associations = valuesObject.associations || {};

  // Only attempt nested updates if values are an object or an array
  associations.models = _.filter(associations.models, function(model) {
    var vals = valuesObject.originalValues[model];
    return _.isPlainObject(vals) || Array.isArray(vals) ? true : false;
  });

  // If no associations were used, return callback
  if(associations.collections.length === 0 && associations.models.length === 0) {
    return cb();
  }

  // Create an array of model instances for each parent
  var parents = values.map(function(val) {
    return new self._model(val);
  });

  // Update any nested associations found in the values object
  var args = [parents, valuesObject.originalValues, valuesObject.associations, cb];
  nestedOperations.update.apply(self, args);

}
