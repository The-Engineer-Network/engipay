"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifySchema = exports.verifyField = exports.isOptionalField = exports.FieldTypeEnum = exports.parseBigInt = void 0;
function parseBigInt(str) {
    if (str == null)
        return null;
    if (typeof (str) !== "string" && typeof (str) !== "number")
        return null;
    try {
        return BigInt(str);
    }
    catch (e) {
        return null;
    }
}
exports.parseBigInt = parseBigInt;
var FieldTypeEnum;
(function (FieldTypeEnum) {
    FieldTypeEnum[FieldTypeEnum["String"] = 0] = "String";
    FieldTypeEnum[FieldTypeEnum["Boolean"] = 1] = "Boolean";
    FieldTypeEnum[FieldTypeEnum["Number"] = 2] = "Number";
    FieldTypeEnum[FieldTypeEnum["BigInt"] = 3] = "BigInt";
    FieldTypeEnum[FieldTypeEnum["Any"] = 4] = "Any";
    FieldTypeEnum[FieldTypeEnum["StringOptional"] = 100] = "StringOptional";
    FieldTypeEnum[FieldTypeEnum["BooleanOptional"] = 101] = "BooleanOptional";
    FieldTypeEnum[FieldTypeEnum["NumberOptional"] = 102] = "NumberOptional";
    FieldTypeEnum[FieldTypeEnum["BigIntOptional"] = 103] = "BigIntOptional";
    FieldTypeEnum[FieldTypeEnum["AnyOptional"] = 104] = "AnyOptional";
})(FieldTypeEnum = exports.FieldTypeEnum || (exports.FieldTypeEnum = {}));
function isAllOptional(schema) {
    for (let key in schema) {
        if (!isOptionalField(schema[key]))
            return false;
    }
    return true;
}
function isOptionalField(type) {
    if (typeof (type) === "function")
        return type(undefined) != null;
    if (typeof (type) === "object")
        return isAllOptional(type);
    return type >= 100;
}
exports.isOptionalField = isOptionalField;
function verifyField(fieldType, val) {
    const type = fieldType;
    if (typeof (type) === "function") {
        const result = type(val);
        if (result == null)
            return;
        return result;
    }
    if (val == null && isOptionalField(type)) {
        return null;
    }
    if (type === FieldTypeEnum.Any || type === FieldTypeEnum.AnyOptional) {
        return val;
    }
    else if (type === FieldTypeEnum.Boolean || type === FieldTypeEnum.BooleanOptional) {
        if (typeof (val) !== "boolean")
            return;
        return val;
    }
    else if (type === FieldTypeEnum.Number || type === FieldTypeEnum.NumberOptional) {
        if (typeof (val) !== "number")
            return;
        if (isNaN(val))
            return;
        return val;
    }
    else if (type === FieldTypeEnum.BigInt || type === FieldTypeEnum.BigIntOptional) {
        const result = parseBigInt(val);
        if (result == null)
            return;
        return result;
    }
    else if (type === FieldTypeEnum.String || type === FieldTypeEnum.StringOptional) {
        if (typeof (val) !== "string")
            return;
        return val;
    }
    else {
        //Probably another request schema
        const result = verifySchema(val, type);
        if (result == null)
            return;
        return result;
    }
}
exports.verifyField = verifyField;
function verifySchema(req, schema) {
    if (req == null)
        return null;
    const resultSchema = {};
    for (let fieldName in schema) {
        const val = req[fieldName];
        const type = schema[fieldName];
        if (typeof (type) === "function") {
            const result = type(val);
            if (result == null)
                return null;
            resultSchema[fieldName] = result;
            continue;
        }
        if (val == null && isOptionalField(type)) {
            resultSchema[fieldName] = null;
            continue;
        }
        if (type === FieldTypeEnum.Any || type === FieldTypeEnum.AnyOptional) {
            resultSchema[fieldName] = val;
        }
        else if (type === FieldTypeEnum.Boolean || type === FieldTypeEnum.BooleanOptional) {
            if (typeof (val) !== "boolean")
                return null;
            resultSchema[fieldName] = val;
        }
        else if (type === FieldTypeEnum.Number || type === FieldTypeEnum.NumberOptional) {
            if (typeof (val) !== "number")
                return null;
            if (isNaN(val))
                return null;
            resultSchema[fieldName] = val;
        }
        else if (type === FieldTypeEnum.BigInt || type === FieldTypeEnum.BigIntOptional) {
            const result = parseBigInt(val);
            if (result == null)
                return null;
            resultSchema[fieldName] = result;
        }
        else if (type === FieldTypeEnum.String || type === FieldTypeEnum.StringOptional) {
            if (typeof (val) !== "string")
                return null;
            resultSchema[fieldName] = val;
        }
        else {
            //Probably another request schema
            const result = verifySchema(val, type);
            if (result == null)
                return null;
            resultSchema[fieldName] = result;
        }
    }
    return resultSchema;
}
exports.verifySchema = verifySchema;
