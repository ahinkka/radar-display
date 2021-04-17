// -*- indent-tabs-mode: nil; -*-
import React from 'react'
import $ from 'jquery'
import LRU from 'lru-cache'

import stringify from 'json-stable-stringify'

import {ImageCanvas} from 'ol/source'
import {Image} from 'ol/layer'
import {Map as OlMap, View} from 'ol'
import {OSM, Vector as VectorSource} from 'ol/source'
import Overlay from 'ol/Overlay'
import {Tile, Vector as VectorLayer} from 'ol/layer'
import {fromLonLat, toLonLat} from 'ol/proj'
import {getDistance} from 'ol/sphere'
import GeoJSON from 'ol/format/GeoJSON'
import {Circle as CircleStyle, Fill, Stroke, Style} from 'ol/style'
import {canvasPxToProductPx, wgs84ToProductPx} from '../reprojection'

import {ObserverActions} from '../constants'

import {DataValueType, integerToDataValue} from './datavalue'
import {
  fillWithNotScanned,
  NOT_SCANNED_COLOR,
  resolveColorForReflectivity,
  resolveColorGeneric
} from './coloring'


// https://24ways.org/2010/calculating-color-contrast
const yiqColorContrast = (r, g, b) => (r*299 + g*587 + b*114 ) / 1000.0 >= 128


const bearingToCompassRoseReading = (bearing) => {
  const cardinals = [
    ['S', 0],   ['SSE', 22.5],  ['SE',  45], ['ESE', 67.5],
    ['E', 90],  ['ENE', 112.5], ['NE', 135], ['NNE', 157.5],
    ['N', 180], ['NNW', 202.5], ['NW', 225], ['WNW', 247.5],
    ['W', 270], ['WSW', 292.5], ['SW', 315], ['SSW', 337.5],
  ]

  let currentClosest = ['X', 360]
  for (let i=0; i<cardinals.length; i++) {
    const [name, angle] = cardinals[i]
    const difference = Math.abs(bearing - angle)

    if (difference < currentClosest[1]) {
      currentClosest = [name, difference]
    } else if (difference > currentClosest[1])
      break
  }

  return currentClosest[0]
}


const renderCursorToolContentAndColors = (
  value, dataScale, dataUnit, color,
  nearestCityName, distanceToNearestCity, bearingToNearestCity,
  nearestTownName, distanceToNearestTown, bearingToNearestTown
) => {
  const [valueType, dataValue] = integerToDataValue(dataScale, value)

  let textContent = null
  let bgColor = 'white'
  let textColor = 'black'
  if (valueType == DataValueType.NOT_SCANNED) {
    textContent = 'NOT SCANNED'
    bgColor = `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0.75)`
  } else if (valueType == DataValueType.NO_ECHO) {
    textContent = 'NO ECHO'
    bgColor = 'rgba(255, 255, 255, 0.75)'
  } else if (valueType == DataValueType.VALUE) {
    textContent = `${dataValue} <small>${dataUnit}</small>`
    bgColor = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${color[3] / 255.0})`
    textColor = !yiqColorContrast(color[0], color[1], color[2]) ? 'white' : 'black'
  }

  if (nearestCityName && distanceToNearestCity !== undefined && bearingToNearestCity !== undefined &&
      nearestTownName && distanceToNearestTown  !== undefined && bearingToNearestTown !== undefined) {
    return [`<div id="cursor-tool-content"><b>${textContent}</b><br><small>${nearestCityName} ${distanceToNearestCity} km ${bearingToCompassRoseReading(bearingToNearestCity)}<br>${nearestTownName} ${distanceToNearestTown} km ${bearingToCompassRoseReading(bearingToNearestTown)}</small></div>`, bgColor, textColor]
  } else {
    return [`<div id="cursor-tool-content"><b>${textContent}</b></div>`, bgColor, textColor]
  }
}


// Source: https://www.movable-type.co.uk/scripts/latlong.html
const bearingBetweenCoordinates = (fromLonLat, toLonLat) => {
  const [fromLon, fromLat] = fromLonLat
  const [toLon, toLat] = toLonLat

  const y = Math.sin(toLon-fromLon) * Math.cos(toLat)
  const x = Math.cos(fromLat) * Math.sin(toLat)
        - Math.sin(fromLat) * Math.cos(toLat) * Math.cos(toLon - fromLon)
  const o = Math.atan2(y, x)
  return (o * 180/Math.PI + 360) % 360
}


const resolveCursorToolContentAndColors = (product, vectorSource, coords, reprojectionCache) => {
  if (!product || !product.metadata) return ['', 'white', 'black']

  const data = product.data
  const dataView = new Uint8Array(data)
  const dataRows = product._rows
  const metadata = product.metadata

  let [nearestCity, distanceToNearestCity, bearingToNearestCity, nearestTown, distanceToNearestTown, bearingToNearestTown] =
    [undefined, undefined, undefined, undefined, undefined, undefined]
  if (vectorSource && vectorSource.getFeatures().length > 0) {
    nearestCity = vectorSource.getClosestFeatureToCoordinate(coords, (feature) => feature.get('osmPlace') === 'city')

    const coordsLonLat = toLonLat(coords)

    const nearestCityLonLat = toLonLat(nearestCity.getGeometry().getCoordinates())
    distanceToNearestCity = Math.round(getDistance(nearestCityLonLat, coordsLonLat) / 1000)
    bearingToNearestCity = bearingBetweenCoordinates(coordsLonLat, nearestCityLonLat)

    nearestTown = vectorSource.getClosestFeatureToCoordinate(coords, (feature) => feature.get('osmPlace') === 'town')
    const nearestTownLonLat = toLonLat(nearestTown.getGeometry().getCoordinates())
    distanceToNearestTown = Math.round(getDistance(nearestTownLonLat, coordsLonLat) / 1000)
    bearingToNearestTown = bearingBetweenCoordinates(coordsLonLat, nearestTownLonLat)
  }

  const dataPxXY = wgs84ToProductPx(
    reprojectionCache,
    metadata.projectionRef,
    metadata.affineTransform,
    metadata.width, metadata.height,
    coords[0], coords[1],
  )

  let effectiveValue = dataView[dataPxXY[0] * dataRows + dataPxXY[1]]
  if (effectiveValue === undefined) effectiveValue = metadata.productInfo.dataScale.notScanned

  const color = metadata.productInfo.dataType == 'REFLECTIVITY' ?
    resolveColorForReflectivity(metadata.productInfo.dataScale, effectiveValue) :
    resolveColorGeneric(metadata.productInfo.dataScale, effectiveValue)

  return renderCursorToolContentAndColors(
    effectiveValue,
    metadata.productInfo.dataScale,
    metadata.productInfo.dataUnit,
    color,
    nearestCity ? nearestCity.get('name') : undefined,
    distanceToNearestCity,
    bearingToNearestCity,
    nearestTown ? nearestTown.get('name') : undefined,
    distanceToNearestTown,
    bearingToNearestTown,
  )
}


// https://openlayers.org/en/latest/examples/overlay.html
const updateCursorTool = (overlay, product, vectorSource, newPosition, resolveTemplateAndColors, reprojectionCache) => {
  const element = overlay.getElement()
  $(element).popover('dispose')

  const effectivePosition = newPosition ? newPosition : overlay.getPosition()
  if (newPosition) overlay.setPosition(effectivePosition)
  const [content, backgroundColor, textColor] = resolveTemplateAndColors(product, vectorSource, effectivePosition, reprojectionCache)

  $(element).popover({
    container: element,
    placement: 'auto',
    offset: '0.5vh, 2vw',
    animation: false,
    html: true,
    content: content,
  })

  $(element)
    .on('inserted.bs.popover', () => {
      $('#cursor-tool-overlay .popover')
        .css('background-color', backgroundColor)

      $('#cursor-tool-overlay .popover *')
        .css('color', textColor)
    })

  $(element).popover('show')
}


export class Map extends React.Component {
  constructor(props) {
    super(props);

    this.__previousProduct = null;

    this.__onResize = this.__onResize.bind(this);
    this.__updateMap = this.__updateMap.bind(this);
    this.__canvasFunction = this.__canvasFunction.bind(this);

    this.__previousIntendedCenter = [0, 0]

    const cacheOpts = {
      max: 50, // maximum number of items
      maxAge: 1000 * 60 * 15, // items considered over 15 minutes are stale
      stale: false,
    }
    this.__renderedProducts = new LRU(cacheOpts)
    this.__colorCaches = {}
    this.reprojectionCache = {}
    this.reprojectionCacheKey = ''

    this.cursorToolVisible = false

    this.__vectorSource = new VectorSource({})

    const cityStyle = new Style({
      image: new CircleStyle({
        radius: 3,
        fill: new Fill({
          color: 'rgba(0,0,0,0.2)',
        }),
        stroke: new Stroke({color: 'black', width: 1}),
      })
    })

    const townStyle = new Style({
      image: new CircleStyle({
        radius: 1,
        stroke: new Stroke({color: 'black', width: 1}),
      })
    })

    this.__vectorLayer = new VectorLayer({
      source: this.__vectorSource,
      style: (feature) => {
        const osmPlace = feature.get('osmPlace')
        if (osmPlace === 'city') {
          return cityStyle
        } else if (osmPlace === 'town') {
          return townStyle
        } else {
          throw new Error(`unknown osmPlace '${osmPlace}'`)
        }
      },
    })
  }

  __onResize() {
    const elem = document.getElementById(this.props.headerElementId)
    const desiredHeight = window.innerHeight - elem.offsetHeight
    const style = '' + desiredHeight + 'px'
    document.getElementById('map-element').style.height = style
    this.map.updateSize()
  }

  __updateMap() {
    if (this.map == undefined) {
      return
    }
    if (this.__previousIntendedCenter[0] != this.props.intendedCenter[0] ||
        this.__previousIntendedCenter[1] != this.props.intendedCenter[1]) {
      const mapProjection = this.map.getView().getProjection()
      this.map.getView().setCenter(fromLonLat(this.props.intendedCenter, mapProjection))
    }
    this.__previousIntendedCenter = this.props.intendedCenter
  }

  componentDidMount() {
    this.map = new OlMap({
      view: new View({
        center: [0, 0],
        zoom: 7
      }),
      layers: [
        new Tile({
          // https://cartodb.com/basemaps
          source: new OSM({
            attributions: [
              ' &copy; <a href="https://cartodb.com/attributions">CartoDB</a>, ' +
              ' &copy; <a href="https://en.ilmatieteenlaitos.fi/open-data-manual-radar-data">FMI Open Radar Data</a>' +
              ' <a href="https://en.ilmatieteenlaitos.fi/open-data-licence">CC BY 4.0</a>, '
            ],
            url: 'https://a.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png'
          })
        }),

        new Tile({
          // https://cartodb.com/basemaps
          source: new OSM({
            url: 'https://a.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png',
            opaque: false
          })
        }),

        this.__vectorLayer,
      ],
      target: 'map-element',
    })

    // Set ratio to 1 for canvas exactly the size of the viewport, i.e. every
    // scroll is a re-render.
    this.imageCanvas = new ImageCanvas({
      canvasFunction: this.__canvasFunction
      // ratio: 1
    })
    this.imageLayer = new Image({ source: this.imageCanvas })
    this.map.getLayers().insertAt(1, this.imageLayer);

    const dispatch = this.props.dispatch
    this.map.on('moveend', function(event) {
      const view = event.map.getView()
      const center = view.getCenter()
      const projection = view.getProjection()
      const lonLatCenter = toLonLat(center, projection)

      dispatch({type: ObserverActions.MAP_MOVED,
        payload: {lon: lonLatCenter[0], lat: lonLatCenter[1]}})
    })

    // https://openlayers.org/en/latest/examples/overlay.html
    const cursorToolElement = document.getElementById('cursor-tool-overlay')
    const cursorToolOverlay = new Overlay({ element: cursorToolElement })
    this.cursorToolOverlay = cursorToolOverlay
    this.map.addOverlay(cursorToolOverlay)

    // https://openlayers.org/en/latest/apidoc/module-ol_MapBrowserEvent-MapBrowserEvent.html
    this.map.on('pointermove', (evt) => {
      if (evt.dragging) {
        return
      }

      updateCursorTool(cursorToolOverlay, this.props.product, this.__vectorSource, evt.coordinate, resolveCursorToolContentAndColors, this.reprojectionCache)
      this.cursorToolVisible = true

      dispatch({type: ObserverActions.POINTER_MOVED, payload: evt.coordinate})
      // const pixel = this.map.getEventPixel(evt.originalEvent)
      // const pointerCoords = this.map.getCoordinateFromPixel(pixel)
    })
    document.getElementById('map-element').addEventListener('mouseleave', () => {
      dispatch({type: ObserverActions.POINTER_LEFT_MAP})
      $(cursorToolElement).popover('dispose');
      this.cursorToolVisible = false
    })

    setTimeout(this.__onResize, 200)
    window.addEventListener('resize', this.__onResize)
    this.__updateMap()
  }

  __canvasFunction(extent, resolution, pixelRatio, size, projection) { // eslint-disable-line no-unused-vars
    const startRender = new Date().getTime();

    this.canvas = document.createElement('canvas')
    this.canvas.width = Math.floor(size[0])
    this.canvas.height = Math.floor(size[1])

    // Short-circuit for cached rendering
    const cacheKey = stringify([this.props.productSelection, this.props.productTime,
      extent, this.canvas.width, this.canvas.height])
    const cached = this.__renderedProducts.get(cacheKey)
    if (cached !== undefined) {
      this.canvas = cached
      if (this.cursorToolVisible)
        updateCursorTool(this.cursorToolOverlay, this.props.product, this.__vectorSource, undefined, resolveCursorToolContentAndColors, this.reprojectionCache)
      return this.canvas
    }

    if (!this.props.product) {
      console.warn('__canvasFunction not rendering because of null currentProduct')
      return this.canvas
    }

    const data = this.props.product.data
    const dataView = new Uint8Array(data)
    const dataRows = this.props.product._rows
    const metadata = this.props.product.metadata

    // Coloring
    let _resolveColor = null
    if (metadata.productInfo.dataType == 'REFLECTIVITY') {
      _resolveColor = resolveColorForReflectivity
    } else {
      _resolveColor = resolveColorGeneric
    }

    // Use the same color cache between calls
    const colorCacheKey = stringify(metadata.productInfo.dataType, metadata.productInfo.dataScale)
    if (!(colorCacheKey in this.__colorCaches)) {
      this.__colorCaches[colorCacheKey] = {}
    }
    const colorCache = this.__colorCaches[colorCacheKey]
    const resolveColor = (value) => {
      if (!(value in colorCache)) {
        colorCache[value] = _resolveColor(metadata.productInfo.dataScale, value)
      }
      return colorCache[value]
    }
    // End of coloring

    const ctx = this.canvas.getContext('2d')
    const imageData = ctx.createImageData(this.canvas.width, this.canvas.height)
    const itemsInARow = imageData.width * 4
    const iData = imageData.data

    // Fill efficiently with NOT_SCANNED_COLOR to reduce array manipulation
    fillWithNotScanned(iData)

    const reprojectionCacheKey = stringify({
      projectionRef: metadata.projectionRef,
      affineTransform: metadata.affineTransform,
      width: metadata.width,
      height: metadata.height,
      mapProjection: 'EPSG:3857'
    })
    if (reprojectionCacheKey != this.reprojectionCacheKey) {
      this.reprojectionCache = {}
      this.reprojectionCacheKey = reprojectionCacheKey
    }

    for (let x=0; x<this.canvas.width; x++) {
      for (let y=0; y<this.canvas.height; y++) {
        const dataPxXY = canvasPxToProductPx(
          this.reprojectionCache,
          metadata.projectionRef,
          metadata.affineTransform,
          metadata.width, metadata.height,
          'EPSG:3857',
          extent,
          this.canvas.width, this.canvas.height,
          x, y
        )

        if (dataPxXY[0] == -1) { // out of product bounds
          continue
        }
        const value = dataView[dataPxXY[0] * dataRows + dataPxXY[1]]
        const color = resolveColor(value)

        if (color != NOT_SCANNED_COLOR) {
          const redIndex = (y * itemsInARow) + (x * 4);
          iData[redIndex] = color[0]
          iData[redIndex + 1] = color[1]
          iData[redIndex + 2] = color[2]
          iData[redIndex + 3] = color[3]

          // This will likely get faster in the future but for now it's slow:
          //  https://bugs.chromium.org/p/v8/issues/detail?id=3590&desc=2
          // iData.set(color, redIndex)
        }
      }
    }
    ctx.putImageData(imageData, 0, 0);

    this.__renderedProducts.set(cacheKey, this.canvas)

    const elapsedMs = new Date().getTime() - startRender;
    const pixelCount = this.canvas.width * this.canvas.height
    console.info('Rendering took', elapsedMs, 'ms @', Math.floor(pixelCount / (elapsedMs / 1000) / 1000), 'kpx/s') // eslint-disable-line no-console

    if (this.cursorToolVisible)
      updateCursorTool(this.cursorToolOverlay, this.props.product, this.__vectorSource, undefined, resolveCursorToolContentAndColors, this.reprojectionCache)
    return this.canvas
  }

  componentWillUnmount() {
    window.removeEventListener('resize', this.__onResize)
  }

  render() {
    if (
      this.props.geoInterests &&
      Object.keys(this.props.geoInterests).length > 0 &&
      this.__vectorSource.getFeatures().length == 0
    ) {
      const features = new GeoJSON({ featureProjection: 'EPSG:3857' })
        .readFeatures(this.props.geoInterests)
      this.__vectorSource.addFeatures(features)
    }

    if (this.__previousProduct == null || this.previousProduct != this.props.product) {
      this.__previousProduct == this.props.product
      if (this.imageCanvas !== undefined) {
        this.imageCanvas.changed()
      }
    }

    this.__updateMap()

    return (
      <React.Fragment>
        <div id="map-element"></div>
        <div id="cursor-tool-overlay"></div>
      </React.Fragment>
    )
  }
}
