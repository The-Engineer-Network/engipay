export declare function parseBigInt(str: string | number): bigint | null;
export declare enum FieldTypeEnum {
    String = 0,
    Boolean = 1,
    Number = 2,
    BigInt = 3,
    Any = 4,
    StringOptional = 100,
    BooleanOptional = 101,
    NumberOptional = 102,
    BigIntOptional = 103,
    AnyOptional = 104
}
export type FieldType<T extends FieldTypeEnum | RequestSchema | ((val: any) => (string | boolean | number | bigint | any))> = T extends FieldTypeEnum.String ? string : T extends FieldTypeEnum.Boolean ? boolean : T extends FieldTypeEnum.Number ? number : T extends FieldTypeEnum.BigInt ? bigint : T extends FieldTypeEnum.Any ? any : T extends FieldTypeEnum.StringOptional ? string : T extends FieldTypeEnum.BooleanOptional ? boolean : T extends FieldTypeEnum.NumberOptional ? number : T extends FieldTypeEnum.BigIntOptional ? bigint : T extends FieldTypeEnum.AnyOptional ? any : T extends RequestSchema ? RequestSchemaResult<T> : T extends ((val: any) => string) ? string : T extends ((val: any) => boolean) ? boolean : T extends ((val: any) => number) ? number : T extends ((val: any) => bigint) ? bigint : T extends ((val: any) => any) ? any : never;
export type RequestSchemaResult<T extends RequestSchema> = {
    [key in keyof T]: FieldType<T[key]>;
};
export type RequestSchemaResultPromise<T extends RequestSchema> = {
    [key in keyof T]: Promise<FieldType<T[key]>>;
};
export type RequestSchema = {
    [fieldName: string]: FieldTypeEnum | RequestSchema | ((val: any) => any);
};
export declare function isOptionalField(type: FieldTypeEnum | RequestSchema | ((val: any) => (string | boolean | number | bigint | any))): boolean;
export declare function verifyField<T extends FieldTypeEnum | RequestSchema | ((val: any) => (string | boolean | number | bigint | any))>(fieldType: T, val: any): FieldType<T>;
export declare function verifySchema<T extends RequestSchema>(req: any, schema: T): RequestSchemaResult<T>;
