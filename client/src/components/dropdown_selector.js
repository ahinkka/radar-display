import React from 'react'

import {OverlayTrigger, Tooltip} from 'react-bootstrap';


const DropdownSelectorOption = (props) => {
  return (
    <option key={props.id} value={props.id}>{props.display}</option>
  )
}


// https://facebook.github.io/react/docs/jsx-gotchas.html
// https://facebook.github.io/react/docs/dom-differences.html
export class DropdownSelector extends React.Component {
  constructor(props) {
    super(props);
    this.handleChange = this.handleChange.bind(this);
  }

  handleChange(e) {
    this.props.dispatch({type: this.props.action, payload: e.target.value})
  }

  render() {
    var options = this.props.items.map(function(item) {
      if (item.id == undefined) {
        console.error('undefined item id attribute', item)
      }
      return (
        <DropdownSelectorOption key={item.id} id={item.id} display={item.display}/>
      )
    })

    const tooltip = (
      <Tooltip id="{this.props.legend}-tooltip">{this.props.tooltip}</Tooltip>
    );

    let selectTitle = 'Select ' + this.props.legend.toLowerCase();
    return (
      <div className="dropdown-selector">
        <OverlayTrigger placement="bottom" overlay={tooltip}>
          <label className="dropdown-selector__label"
            htmlFor="{this.props.legend}-select"
            title={this.props.legend}>{this.props.legend}</label>
        </OverlayTrigger>
        <select id="{this.props.legend}-select" className="form-control dropdown-selector__select"
          value={this.props.currentValue} onChange={this.handleChange}
          disabled={this.props.disabled} title={selectTitle}>
          {options}
        </select>
      </div>
    );
  }
}
