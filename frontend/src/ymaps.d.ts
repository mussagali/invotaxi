declare namespace ymaps {
  function ready(callback?: () => void): Promise<void>;

  const modules: {
    require: (
      modules: string[],
      successCallback: () => void,
      errorCallback?: (error: Error) => void,
    ) => void;
  };

  function geocode(
    request: string | number[],
    options?: {
      results?: number;
      kind?: string;
      boundedBy?: number[][];
      strictBounds?: boolean;
      provider?: string;
    }
  ): Promise<any>;

  function suggest(
    request: string,
    options?: { boundedBy?: number[][]; results?: number }
  ): Promise<Array<{ displayName: string; value: string; hl?: number[][] }>>;

  function route(
    points: number[][] | string[],
    options?: { mapStateAutoApply?: boolean; multiRoute?: boolean; routingMode?: string }
  ): Promise<any>;

  class Map {
    constructor(
      element: HTMLElement | string,
      state: {
        center: number[];
        zoom: number;
        controls?: string[];
      },
      options?: Record<string, any>
    );
    geoObjects: GeoObjectCollection;
    events: IEventManager;
    destroy(): void;
    setCenter(center: number[], zoom?: number, options?: Record<string, any>): void;
    getCenter(): number[];
    getZoom(): number;
    setZoom(zoom: number): void;
    setBounds(bounds: number[][], options?: Record<string, any>): void;
    getBounds(): number[][];
    container: { getSize(): number[] };
    controls: ControlManager;
  }

  class Placemark {
    constructor(
      geometry: number[],
      properties?: Record<string, any>,
      options?: Record<string, any>
    );
    geometry: IPointGeometry;
    events: IEventManager;
    options: IOptionManager;
    properties: IDataManager;
  }

  class Circle {
    constructor(
      geometry: [number[], number],
      properties?: Record<string, any>,
      options?: Record<string, any>
    );
    geometry: any;
    events: IEventManager;
  }

  class Polygon {
    constructor(
      geometry: number[][][],
      properties?: Record<string, any>,
      options?: Record<string, any>
    );
    geometry: IPolygonGeometry;
    events: IEventManager;
  }

  class Polyline {
    constructor(
      geometry: number[][],
      properties?: Record<string, any>,
      options?: Record<string, any>
    );
    geometry: any;
    events: IEventManager;
  }

  class GeoObjectCollection {
    constructor(options?: Record<string, any>);
    add(child: any): this;
    remove(child: any): this;
    removeAll(): this;
    get(index: number): any;
    getLength(): number;
    each(callback: (geoObject: any) => void): void;
    getBounds(): number[][] | null;
  }

  class SuggestView {
    constructor(element: HTMLElement | string, options?: Record<string, any>);
    events: IEventManager;
    destroy(): void;
    state: { get(key: string): any };
  }

  namespace control {
    class SearchControl {
      constructor(options?: { options?: Record<string, any> });
      events: IEventManager;
      getResult(index: number): Promise<any>;
    }
  }

  interface ControlManager {
    add(control: any): void;
    remove(control: any): void;
  }

  interface IEventManager {
    add(type: string | string[], callback: (e: any) => void, context?: any): this;
    remove(type: string | string[], callback: (e: any) => void, context?: any): this;
  }

  interface IPointGeometry {
    getCoordinates(): number[];
    setCoordinates(coords: number[]): void;
  }

  interface IPolygonGeometry {
    getCoordinates(): number[][][];
    setCoordinates(coords: number[][][]): void;
    get(index: number): any;
  }

  interface IOptionManager {
    set(key: string | Record<string, any>, value?: any): void;
    get(key: string): any;
  }

  interface IDataManager {
    set(key: string | Record<string, any>, value?: any): void;
    get(key: string): any;
  }

  namespace multiRouter {
    class MultiRoute {
      constructor(model: Record<string, any>, options?: Record<string, any>);
      events: IEventManager;
      model: {
        events: IEventManager;
      };
      getActiveRoute(): {
        properties: IDataManager;
        getPaths(): GeoObjectCollection;
      } | null;
      getLength(): number;
      getTime(): number;
    }
  }
}

declare global {
  interface Window {
    ymaps: typeof ymaps;
  }
}

export {};
