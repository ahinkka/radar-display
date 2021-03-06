import { Component } from 'react'
import PropTypes from 'prop-types'

import { batch, connect } from 'react-redux'

import * as L from 'partial.lenses'

import {
  catalogL,
  selectedSiteIdL,
  selectedProductIdL,
  selectedFlavorIdL,
  animationRunningL,
  currentLonL,
  currentLatL
} from '../state_reduction'
import { makeHashFromState, parseHash } from '../state_hash'
import { ObserverActions } from '../constants'
import { lensesToProps } from '../utils'


class UrlStateAdapter extends Component {
  static propTypes = {
    dispatch: PropTypes.func
  }

  constructor() {
    super()
    this.loadHash.bind(this)
    this.updateHash.bind(this)
    this.updates = null
  }

  componentDidMount() {
    this.loadHash()
  }

  render() {
    if (this.updates) {
      const dispatch = this.props.dispatch
      const updates = this.updates
      setTimeout(() => {
        batch(() => updates.forEach(dispatch))
        this.updates = null
      }, 0)
    }

    if (L.get(currentLonL, this.props) && L.get(currentLatL, this.props)) {
      this.updateHash(this.props)
    }

    return null
  }

  loadHash() {
    this.updates = []    
    if (window.location.hash != '') {
      const parsed = parseHash(window.location.hash)
      this.updates.push({type: ObserverActions.SITE_SELECTED, payload: parsed.site})
      this.updates.push({type: ObserverActions.PRODUCT_SELECTED, payload: parsed.product})
      this.updates.push({type: ObserverActions.FLAVOR_SELECTED, payload: parsed.flavor})
      this.updates.push({type: ObserverActions.FLAVOR_SELECTED, payload: parsed.flavor})

      const animationRunning = parsed.animationRunning == 'true' ? true : false
      if (this.props.animation.running != animationRunning) {
        this.updates.push({type: ObserverActions.TOGGLE_ANIMATION})
      }

      const [lon, lat] = [parseFloat(parsed.lon), parseFloat(parsed.lat)]
      if (!isNaN(lon) && !isNaN(lat)) {
        this.updates.push({type: ObserverActions.MAP_CENTER_CHANGED, payload: {lon: lon, lat: lat}})
      } else {
        this.updates.push({type: ObserverActions.MAKE_CURRENT_SITE_INTENDED})
      }
    }
  }

  updateHash(state) {
    const hash = makeHashFromState(state)
    if (hash != window.location.hash) {
      let hashLess = window.location.href
      if (window.location.href.includes('#')) {
        hashLess = window.location.href.split('#')[0]
      }
      window.history.pushState(null, null, hashLess + hash)
    }
  }
}

const mapStateToProps = lensesToProps([
  catalogL, selectedSiteIdL, selectedProductIdL, selectedFlavorIdL,
  animationRunningL, currentLonL, currentLatL
])
export default connect(mapStateToProps)(UrlStateAdapter)
