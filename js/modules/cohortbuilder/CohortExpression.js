define(function (require, exports) {

	var ko = require('knockout');
	var CriteriaGroup = require('./CriteriaGroup');
	var ConceptSet = require('conceptsetbuilder/InputTypes/ConceptSet');
	var PrimaryCriteria = require('./PrimaryCriteria');
	var InclusionRule = require('./InclusionRule');
	var EndStrategies = require('./EndStrategies');
	
	function CohortExpression(data) {
		var self = this;
		var data = data || {};

		
		self.ConceptSets = ko.observableArray(data.ConceptSets && data.ConceptSets.map(function(d) { return new ConceptSet(d) }));
		self.PrimaryCriteria = ko.observable(new PrimaryCriteria(data.PrimaryCriteria, self.ConceptSets));
		self.AdditionalCriteria = ko.observable(data.AdditionalCriteria && new CriteriaGroup(data.AdditionalCriteria, self.ConceptSets));
		self.QualifiedLimit =  { Type: ko.observable(data.QualifiedLimit && data.ExpressionLimit.Type || "First") }
		self.ExpressionLimit =  { Type: ko.observable(data.ExpressionLimit && data.ExpressionLimit.Type || "First") }
		self.InclusionRules = ko.observableArray(data.InclusionRules && data.InclusionRules.map(function (rule) {
			return new InclusionRule(rule, self.ConceptSets);	
		}));
		self.EndStrategy = ko.observable(data.EndStrategy && EndStrategies.GetStrategyFromObject(data.EndStrategy, self.ConceptSets));		
		
	}
	return CohortExpression;
});