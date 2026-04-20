const React = require("react");

class MockedCSSModule {
  constructor() {
    // Generate unique class names for each property access
    this.appShell = "appShell_mock";
    this.header = "header_mock";
    this.eyebrow = "eyebrow_mock";
    this.title = "title_mock";
    this.headerMeta = "headerMeta_mock";
    this.badgeFree = "badgeFree_mock";
    this.badgePro = "badgePro_mock";
    this.statusText = "statusText_mock";
    this.contentStack = "contentStack_mock";
    this.panel = "panel_mock";
    this.errorPanel = "errorPanel_mock";
    this.panelTitle = "panelTitle_mock";
    this.panelBody = "panelBody_mock";
    this.secondaryButton = "secondaryButton_mock";
  }
}

module.exports = new MockedCSSModule();
