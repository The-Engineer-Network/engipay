export interface IParamReader {

    /**
     * Returns a promise when the specific property with the name is read from the stream
     *
     * @param name Name of the property
     */
    getParam<T>(name: string): Promise<T>;

}