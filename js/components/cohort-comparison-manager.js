define(['jquery', 'knockout', 'text!./cohort-comparison-manager.html', 'webapi/CohortDefinitionAPI', 'appConfig', 'ohdsi.util', 'cohortcomparison/ComparativeCohortAnalysis', 'cohortbuilder/options', 'cohortbuilder/CohortDefinition', 'vocabularyprovider', 'conceptsetbuilder/InputTypes/ConceptSet', 'nvd3', 'css!./styles/nv.d3.min.css'],
	function ($, ko, view, cohortDefinitionAPI, config, ohdsiUtil, ComparativeCohortAnalysis, options, CohortDefinition, vocabularyAPI, ConceptSet) {
		function cohortComparisonManager(params) {

			var self = this;
			self.cohortComparisonId = params.currentCohortComparisonId;
			self.config = config;
			self.loading = ko.observable(true);
			self.loadingExecution = ko.observable(false);
			self.loadingExecutionFailure = ko.observable(false);
			self.covariates = ko.observableArray();
			self.currentExecutionId = ko.observable();
			self.currentExecutionAuc = ko.observable();
			self.matchedpopdist = ko.observableArray();
			self.psmodeldist = ko.observableArray();
			self.attrition = ko.observableArray();
			self.sources = ko.observableArray();
			self.currentExecutionSourceName = ko.observable();
			self.sourceHistoryDisplay = {};
			self.sourceProcessingStatus = {};
			self.sourceExecutions = {};
            self.options = options;
            self.expressionMode = ko.observable('print');
            self.cohortComparison = ko.observable();
            self.cohortComparisonDirtyFlag = ko.observable();

			var initSources = config.services[0].sources.filter(s => s.hasCDM);
			for (var i = 0; i < initSources.length; i++) {
				self.sourceHistoryDisplay[initSources[i].sourceKey] = ko.observable(false);
				self.sourceProcessingStatus[initSources[i].sourceKey] = ko.observable(false);
			}

			self.sources(initSources);

			self.loadExecutions = function () {
				// reset before load
				$.each(self.sources(), function (i, s) {
					if (!self.sourceExecutions[s.sourceKey]) {
						self.sourceExecutions[s.sourceKey] = ko.observableArray();
					} else {
						self.sourceExecutions[s.sourceKey].removeAll();
					}
				});

				$.ajax({
					url: config.services[0].url + 'comparativecohortanalysis/' + self.cohortComparisonId() + '/executions',
					method: 'GET',
					contentType: 'application/json',
					success: function (response) {
						
						response = response.sort(function(a,b){
							return a.executed - b.executed;
						});

						$.each(response, function (i, d) {
							var sourceKey = self.sources().filter(s => s.sourceId == d.sourceId)[0].sourceKey;
							var executedTimestamp = new Date(d.executed);
							d.executedCaption = executedTimestamp.toLocaleDateString() + ' ' + executedTimestamp.toLocaleTimeString();

							var h = Math.floor(((d.duration % 31536000) % 86400) / 3600);
							var m = Math.floor((((d.duration % 31536000) % 86400) % 3600) / 60);
							var s = (((d.duration % 31536000) % 86400) % 3600) % 60;

							d.durationCaption = ''
							if (h > 0) d.durationCaption += h + 'h ';
							if (m > 0) d.durationCaption += m + 'm ';
							if (s > 0) d.durationCaption += s + 's ';

							if (h == 0 && m == 0 && s == 0) {
								d.durationCaption = 'n/a';
							}

							// this will ensure that if the last execution is still running that we don't allow additional executions to begin
							if (d.executionStatus != 'COMPLETED') {
								self.sourceProcessingStatus[sourceKey](true);
							} else {
								self.sourceProcessingStatus[sourceKey](false);
							}

							self.sourceExecutions[sourceKey].push(d);
						});
					}
				});
			}

			self.loadExecutions();

			self.toggleHistoryDisplay = function (sourceKey) {
				self.sourceHistoryDisplay[sourceKey](!self.sourceHistoryDisplay[sourceKey]());
			}

			self.covariateColumns = [
				{
					title: 'Id',
					data: 'id'
			},
				{
					title: 'Name',
					data: 'name'
			},
				{
					title: 'Value',
					data: 'value'
			}
		];

			self.covariateOptions = {
				lengthMenu: [[10, -1], ['10', 'All']],
				Facets: [
					{
						'caption': 'Value',
						'binding': function (o) {
							if (o.value > 2) {
								return '> 2';
							} else if (o.value < -2) {
								return '< -2';
							} else {
								return 'Other';
							}
						}
				}
			]
			};

			self.tabMode = ko.observable('specification');
			self.resultsMode = ko.observable('sources');
			self.pillMode = ko.observable('covariates');

			self.pillMode.subscribe(function (d) {
				window.setTimeout(function (d) {
					window.dispatchEvent(new Event('resize'));
				}, 1);
			})

			self.covariateSelected = function (d) {
				console.log(d);
			}

			self.closeExecution = function () {
				self.resultsMode('sources');
			}

			self.viewLastExecution = function (source) {
				var lastIndex = self.sourceExecutions[source.sourceKey]().length - 1;
				var execution = self.sourceExecutions[source.sourceKey]()[lastIndex];
				self.executionSelected(execution);
			}

			self.executionSelected = function (d) {
				self.loadingExecutionFailure(false);
				self.resultsMode('execution');
				self.loadingExecution(true);

				var sourceName = self.sources().filter(s => s.sourceId == d.sourceId)[0].sourceName;
				self.currentExecutionSourceName(sourceName);

				var p1 = $.ajax({
					url: config.services[0].url + 'comparativecohortanalysis/execution/' + d.executionId + '/psmodel',
					method: 'GET',
					contentType: 'application/json',
					success: function (response) {
						self.currentExecutionId(d.executionId);
						self.currentExecutionAuc(response.auc);
						self.covariates(response.covariates);
					}
				});

				var p2 = $.ajax({
					url: config.services[0].url + 'comparativecohortanalysis/execution/' + d.executionId + '/attrition',
					method: 'GET',
					contentType: 'application/json',
					success: function (response) {
						self.attrition(response);
					}
				});

				var p3 = $.ajax({
					url: config.services[0].url + 'comparativecohortanalysis/execution/' + d.executionId + '/balance',
					method: 'GET',
					contentType: 'application/json',
					success: function (response) {
						nv.addGraph(function () {

							var points = response.map(d => ({
								x: Math.abs(d.beforeMatchingStdDiff),
								y: Math.abs(d.afterMatchingStdDiff),
								tooltip: d.covariateName
							}));
							var data = [{
								key: 'Covariates',
								values: points
							}];

							var balanceChart = nv.models.scatterChart()
								.forceY([0, 2])
								.forceX([0, 2])
								.showDistX(true)
								.showDistY(true)
								.color(d3.scale.category10().range());

							balanceChart.tooltip.contentGenerator(function (d) {
								return '<div class="scatterTooltip"><div>' + d.point.tooltip + '</div><div>Before Matching: ' + d.point.x + '</div><div>After Matching: ' + d.point.y + '</div></div>';
							});

							//Axis settings
							balanceChart.xAxis.tickFormat(d3.format('.02f'));
							balanceChart.yAxis.tickFormat(d3.format('.02f'));

							d3.select('#balanceChart svg')
								.datum(data)
								.call(balanceChart);

							nv.utils.windowResize(balanceChart.update);

							return balanceChart;
						});
					}
				});

				var p4 = $.ajax({
					url: config.services[0].url + 'comparativecohortanalysis/execution/' + d.executionId + '/matchedpopdist',
					method: 'GET',
					contentType: 'application/json',
					success: function (response) {
						self.matchedpopdist(response);

						var data = [
							{
								values: response.map(d => ({
									'x': d.ps,
									'y': d.comparator
								})).sort(function (a, b) {
									return a.x - b.x
								}),
								key: 'Comparator',
								color: '#000088',
								area: true
							},
							{
								values: response.map(d => ({
									'x': d.ps,
									'y': d.treatment
								})).sort(function (a, b) {
									return a.x - b.x
								}),
								key: 'Treatment',
								color: '#880000',
								area: true
							}
						];

						nv.addGraph(function () {
							var matchedChart = nv.models.lineChart()
								.useInteractiveGuideline(true)
								.interpolate("basis");

							matchedChart.duration(0);

							d3.select("#matchedpopdistChart svg")
								.datum(data)
								.call(matchedChart);

							nv.utils.windowResize(matchedChart.update);
							return matchedChart;
						});
					}
				});

				var p5 = $.ajax({
					url: config.services[0].url + 'comparativecohortanalysis/execution/' + d.executionId + '/psmodeldist',
					method: 'GET',
					contentType: 'application/json',
					success: function (response) {
						var comparatorMax = d3.max(response, d => d.comparator);
						var treatmentMax = d3.max(response, d => d.treatment);

						var data = [
							{
								values: response.map(d => ({
									'x': d.ps,
									'y': d.comparator / comparatorMax
								})).sort(function (a, b) {
									return a.x - b.x
								}),
								key: 'Comparator',
								color: '#000088',
								area: true
							},
							{
								values: response.map(d => ({
									'x': d.ps,
									'y': d.treatment / treatmentMax
								})).sort(function (a, b) {
									return a.x - b.x
								}),
								key: 'Treatment',
								color: '#880000',
								area: true
							}
						];


						nv.addGraph(function () {
							var modelChart = nv.models.lineChart()
								.useInteractiveGuideline(true)
								.interpolate("basis");

							modelChart.duration(0);

							d3.select("#psmodeldistChart svg")
								.datum(data)
								.call(modelChart);

							nv.utils.windowResize(modelChart.update);
							return modelChart;
						});
					}
				});

				Promise.all([p1, p2, p3, p4, p5])
					.then(results => {
						self.loadingExecution(false);
					})
					.catch(error => {
						self.loadingExecution(false);
						self.resultsMode('sources');
						self.loadingExecutionFailure(true);
					});
			}

			self.cohortSelected = function (id) {
                $('cohort-comparison-manager #modalCohortDefinition').modal('hide');
				cohortDefinitionAPI.getCohortDefinition(id).then(function (cohortDefinition) {
					self.targetId(cohortDefinition.id);
					self.targetCaption(cohortDefinition.name);
                    cohortDefinition.expression = JSON.parse(cohortDefinition.expression);
                    self.targetCohortDefinition(new CohortDefinition(cohortDefinition));                    
				});
			}

			self.canSave = ko.pureComputed(function () {
				return (self.cohortComparison().name() 
                        && self.cohortComparison().comparatorId() && self.cohortComparison().comparatorId() > 0
                        && self.cohortComparison().treatmentId() && self.cohortComparison().treatmentId() > 0
                        && self.cohortComparison().outcomeId() && self.cohortComparison().outcomeId() > 0
                        && self.cohortComparison().modelType && self.cohortComparison().modelType() > 0
                        && self.cohortComparisonDirtyFlag() && self.cohortComparisonDirtyFlag().isDirty());
			});

			self.save = function () {

				var cca = {
					name: self.cohortComparison().name(),
					treatmentId: self.cohortComparison().treatmentId(),
					comparatorId: self.cohortComparison().comparatorId(),
					outcomeId: self.cohortComparison().outcomeId(),
					modelType: self.cohortComparison().modelType(),
                    timeAtRiskStart: self.cohortComparison().timeAtRiskStart(),
                    timeAtRiskEnd: self.cohortComparison().timeAtRiskEnd(),
                    addExposureDaysToEnd: self.cohortComparison().addExposureDaysToEnd(),
                    minimumWashoutPeriod: self.cohortComparison().minimumWashoutPeriod(),
                    minimumDaysAtRisk: self.cohortComparison().minimumDaysAtRisk(),
                    rmSubjectsInBothCohorts: self.cohortComparison().rmSubjectsInBothCohorts(),
                    rmPriorOutcomes: self.cohortComparison().rmPriorOutcomes(),
                    psAdjustment: self.cohortComparison().psAdjustment(),
                    psExclusionId: self.cohortComparison().psExclusionId(),
                    psInclusionId: self.cohortComparison().psInclusionId(),
                    psDemographics: self.cohortComparison().psDemographics() | 0,
                    psDemographicsGender: self.cohortComparison().psDemographicsGender() | 0,
                    psDemographicsRace: self.cohortComparison().psDemographicsRace() | 0,
                    psDemographicsEthnicity: self.cohortComparison().psDemographicsEthnicity() | 0,
                    psDemographicsAge: self.cohortComparison().psDemographicsAge() | 0,
                    psDemographicsYear: self.cohortComparison().psDemographicsYear() | 0,
                    psDemographicsMonth: self.cohortComparison().psDemographicsMonth() | 0,
                    psTrim: self.cohortComparison().psTrim(),
                    psTrimFraction: self.cohortComparison().psTrimFraction(),
                    psMatch: self.cohortComparison().psMatch(),
                    psMatchMaxRatio: self.cohortComparison().psMatchMaxRatio(),
                    psStrat: self.cohortComparison().psStrat() | 0,
                    psStratNumStrata: self.cohortComparison().psStratNumStrata(),
                    psConditionOcc: self.cohortComparison().psConditionOcc() | 0,
                    psConditionOcc365d: self.cohortComparison().psConditionOcc365d() | 0,
                    psConditionOcc30d: self.cohortComparison().psConditionOcc30d() | 0,
                    psConditionOccInpt180d: self.cohortComparison().psConditionOccInpt180d() | 0,
                    psConditionEra: self.cohortComparison().psConditionEra() | 0,
                    psConditionEraEver: self.cohortComparison().psConditionEraEver() | 0,
                    psConditionEraOverlap: self.cohortComparison().psConditionEraOverlap() | 0,
                    psConditionGroup: self.cohortComparison().psConditionGroup() | 0,
                    psConditionGroupMeddra: self.cohortComparison().psConditionGroupMeddra() | 0,
                    psConditionGroupSnomed: self.cohortComparison().psConditionGroupSnomed() | 0,
                    psDrugExposure: self.cohortComparison().psDrugExposure() | 0,
                    psDrugExposure365d: self.cohortComparison().psDrugExposure365d() | 0,
                    psDrugExposure30d: self.cohortComparison().psDrugExposure30d() | 0,
                    psDrugEra: self.cohortComparison().psDrugEra() | 0,
                    psDrugEra365d: self.cohortComparison().psDrugEra365d() | 0,
                    psDrugEra30d: self.cohortComparison().psDrugEra30d() | 0,
                    psDrugEraOverlap: self.cohortComparison().psDrugEraOverlap() | 0,
                    psDrugEraEver: self.cohortComparison().psDrugEraEver() | 0,
                    psDrugGroup: self.cohortComparison().psDrugGroup() | 0,
                    psProcedureOcc: self.cohortComparison().psProcedureOcc() | 0,
                    psProcedureOcc365d: self.cohortComparison().psProcedureOcc365d() | 0,
                    psProcedureOcc30d: self.cohortComparison().psProcedureOcc30d() | 0,
                    psProcedureGroup: self.cohortComparison().psProcedureGroup() | 0,
                    psObservation: self.cohortComparison().psObservation() | 0,
                    psObservation365d: self.cohortComparison().psObservation365d() | 0,
                    psObservation30d: self.cohortComparison().psObservation30d() | 0,
                    psObservationCount365d: self.cohortComparison().psObservationCount365d() | 0,
                    psMeasurement: self.cohortComparison().psMeasurement() | 0,
                    psMeasurement365d: self.cohortComparison().psMeasurement365d() | 0,
                    psMeasurement30d: self.cohortComparison().psMeasurement30d() | 0,
                    psMeasurementCount365d: self.cohortComparison().psMeasurementCount365d() | 0,
                    psMeasurementBelow: self.cohortComparison().psMeasurementBelow() | 0,
                    psMeasurementAbove: self.cohortComparison().psMeasurementAbove() | 0,
                    psConceptCounts: self.cohortComparison().psConceptCounts() | 0,
                    psRiskScores: self.cohortComparison().psRiskScores() | 0,
                    psRiskScoresCharlson: self.cohortComparison().psRiskScoresCharlson() | 0,
                    psRiskScoresDcsi: self.cohortComparison().psRiskScoresDcsi() | 0,
                    psRiskScoresChads2: self.cohortComparison().psRiskScoresChads2() | 0,
                    psRiskScoresChads2vasc: self.cohortComparison().psRiskScoresChads2vasc() | 0,
                    psInteractionYear: self.cohortComparison().psInteractionYear() | 0,
                    psInteractionMonth: self.cohortComparison().psInteractionMonth() | 0,
                    omCovariates: self.cohortComparison().omCovariates(),
                    omExclusionId: self.cohortComparison().omExclusionId(),
                    omInclusionId: self.cohortComparison().omInclusionId(),
                    omDemographics: self.cohortComparison().omDemographics() | 0,
                    omDemographicsGender: self.cohortComparison().omDemographicsGender() | 0,
                    omDemographicsRace: self.cohortComparison().omDemographicsRace() | 0,
                    omDemographicsEthnicity: self.cohortComparison().omDemographicsEthnicity() | 0,
                    omDemographicsAge: self.cohortComparison().omDemographicsAge() | 0,
                    omDemographicsYear: self.cohortComparison().omDemographicsYear() | 0,
                    omDemographicsMonth: self.cohortComparison().omDemographicsMonth() | 0,
                    omTrim: self.cohortComparison().omTrim(),
                    omTrimFraction: self.cohortComparison().omTrimFraction(),
                    omMatch: self.cohortComparison().omMatch(),
                    omMatchMaxRatio: self.cohortComparison().omMatchMaxRatio(),
                    omStrat: self.cohortComparison().omStrat() | 0,
                    omStratNumStrata: self.cohortComparison().omStratNumStrata(),
                    omConditionOcc: self.cohortComparison().omConditionOcc() | 0,
                    omConditionOcc365d: self.cohortComparison().omConditionOcc365d() | 0,
                    omConditionOcc30d: self.cohortComparison().omConditionOcc30d() | 0,
                    omConditionOccInpt180d: self.cohortComparison().omConditionOccInpt180d() | 0,
                    omConditionEra: self.cohortComparison().omConditionEra() | 0,
                    omConditionEraEver: self.cohortComparison().omConditionEraEver() | 0,
                    omConditionEraOverlap: self.cohortComparison().omConditionEraOverlap() | 0,
                    omConditionGroup: self.cohortComparison().omConditionGroup() | 0,
                    omConditionGroupMeddra: self.cohortComparison().omConditionGroupMeddra() | 0,
                    omConditionGroupSnomed: self.cohortComparison().omConditionGroupSnomed() | 0,
                    omDrugExposure: self.cohortComparison().omDrugExposure() | 0,
                    omDrugExposure365d: self.cohortComparison().omDrugExposure365d() | 0,
                    omDrugExposure30d: self.cohortComparison().omDrugExposure30d() | 0,
                    omDrugEra: self.cohortComparison().omDrugEra() | 0,
                    omDrugEra365d: self.cohortComparison().omDrugEra365d() | 0,
                    omDrugEra30d: self.cohortComparison().omDrugEra30d() | 0,
                    omDrugEraOverlap: self.cohortComparison().omDrugEraOverlap() | 0,
                    omDrugEraEver: self.cohortComparison().omDrugEraEver() | 0,
                    omDrugGroup: self.cohortComparison().omDrugGroup() | 0,
                    omProcedureOcc: self.cohortComparison().omProcedureOcc() | 0,
                    omProcedureOcc365d: self.cohortComparison().omProcedureOcc365d() | 0,
                    omProcedureOcc30d: self.cohortComparison().omProcedureOcc30d() | 0,
                    omProcedureGroup: self.cohortComparison().omProcedureGroup() | 0,
                    omObservation: self.cohortComparison().omObservation() | 0,
                    omObservation365d: self.cohortComparison().omObservation365d() | 0,
                    omObservation30d: self.cohortComparison().omObservation30d() | 0,
                    omObservationCount365d: self.cohortComparison().omObservationCount365d() | 0,
                    omMeasurement: self.cohortComparison().omMeasurement() | 0,
                    omMeasurement365d: self.cohortComparison().omMeasurement365d() | 0,
                    omMeasurement30d: self.cohortComparison().omMeasurement30d() | 0,
                    omMeasurementCount365d: self.cohortComparison().omMeasurementCount365d() | 0,
                    omMeasurementBelow: self.cohortComparison().omMeasurementBelow() | 0,
                    omMeasurementAbove: self.cohortComparison().omMeasurementAbove() | 0,
                    omConceptCounts: self.cohortComparison().omConceptCounts() | 0,
                    omRiskScores: self.cohortComparison().omRiskScores() | 0,
                    omRiskScoresCharlson: self.cohortComparison().omRiskScoresCharlson() | 0,
                    omRiskScoresDcsi: self.cohortComparison().omRiskScoresDcsi() | 0,
                    omRiskScoresChads2: self.cohortComparison().omRiskScoresChads2() | 0,
                    omRiskScoresChads2vasc: self.cohortComparison().omRiskScoresChads2vasc() | 0,
                    omInteractionYear: self.cohortComparison().omInteractionYear() | 0,
                    omInteractionMonth: self.cohortComparison().omInteractionMonth() | 0,
                    delCovariatesSmallCount: self.cohortComparison().delCovariatesSmallCount(),
                    negativeControlId: self.cohortComparison().negativeControlId()
				};

				if (self.cohortComparisonId() != 0) {
					cca.analysisId = self.cohortComparisonId();
				}

				var json = JSON.stringify(cca);

				var savePromise = $.ajax({
					method: 'POST',
					url: config.services[0].url + 'comparativecohortanalysis/',
					contentType: 'application/json',
					data: json,
					dataType: 'json',
					success: function (data) {}
				});

				savePromise.then(function (saveResult) {
    				var redirectWhenComplete = saveResult.analysisId != self.cohortComparisonId();
                    self.cohortComparisonId(saveResult.analysisId);
                    if (redirectWhenComplete) {
                        document.location = "#/estimation/" + self.cohortComparisonId();
                    }
                    self.cohortComparisonDirtyFlag().reset();
					console.log(saveResult);
				});
			}

			self.close = function () {
				document.location = '#/estimation';
			}

			self.conceptsetSelected = function (d) {
                $('cohort-comparison-manager #modalConceptSet').modal('hide');
                vocabularyAPI.getConceptSetExpression(d.id).then(function (csExpression) {
                    self.targetId(d.id);
                    self.targetCaption(d.name);
                    var conceptSetData = new ConceptSet({id: d.id, name: d.name, expression: csExpression});
                    self.targetExpression.removeAll();
                    self.targetExpression.push(conceptSetData);
                        
                    vocabularyAPI.resolveConceptSetExpression(csExpression).then(
                        function (data) {
                            self.targetConceptIds(data);
                        });
                });
			}

			self.chooseTreatment = function () {
				$('cohort-comparison-manager #modalCohortDefinition').modal('show');
				self.targetId = self.cohortComparison().treatmentId;
				self.targetCaption = self.cohortComparison().treatmentCaption;
                self.targetCohortDefinition = self.cohortComparison().treatmentCohortDefinition;
			}

			self.chooseComparator = function () {
				$('cohort-comparison-manager #modalCohortDefinition').modal('show');
				self.targetId = self.cohortComparison().comparatorId;
				self.targetCaption = self.cohortComparison().comparatorCaption;
                self.targetCohortDefinition = self.cohortComparison().comparatorCohortDefinition;
			}

			self.chooseOutcome = function () {
				$('cohort-comparison-manager #modalCohortDefinition').modal('show');
				self.targetId = self.cohortComparison().outcomeId;
				self.targetCaption = self.cohortComparison().outcomeCaption;
                self.targetCohortDefinition = self.cohortComparison().outcomeCohortDefinition;
			}
            
            self.clearTreatment = function() {
                self.cohortComparison().treatmentId(0);
                self.cohortComparison().treatmentCaption(null);
                self.cohortComparison().treatmentCohortDefinition(null);
            }

            self.clearComparator = function() {
                self.cohortComparison().comparatorId(0);
                self.cohortComparison().comparatorCaption(null);
                self.cohortComparison().comparatorCohortDefinition(null);
            }

            self.clearOutcome = function() {
                self.cohortComparison().outcomeId(0);
                self.cohortComparison().outcomeCaption(null);
                self.cohortComparison().outcomeCohortDefinition(null);
            }
            
			self.clearPsExclusion = function () {
                self.cohortComparison().psExclusionId(0);
				self.cohortComparison().psExclusionCaption(null);
                self.cohortComparison().psExclusionConceptSet.removeAll();
                self.cohortComparison().psExclusionConceptSetSQL(null);
			}
			
            self.clearPsInclusion = function () {
                self.cohortComparison().psInclusionId(0);
				self.cohortComparison().psInclusionCaption(null);
                self.cohortComparison().psInclusionConceptSet.removeAll();
                self.cohortComparison().psInclusionConceptSetSQL(null);
			}

            self.clearOmExclusion = function () {
                self.cohortComparison().omExclusionId(0);
				self.cohortComparison().omExclusionCaption(null);
                self.cohortComparison().omExclusionConceptSet.removeAll();
                self.cohortComparison().omExclusionConceptSetSQL(null);
			}
			
            self.clearOmInclusion = function () {
                self.cohortComparison().omInclusionId(0);
				self.cohortComparison().omInclusionCaption(null);
                self.cohortComparison().omInclusionConceptSet.removeAll();
                self.cohortComparison().omInclusionConceptSetSQL(null);
			}
            
            self.clearNegativeControl= function () {
                self.cohortComparison().negativeControlId(0);
				self.cohortComparison().negativeControlCaption(null);
                self.cohortComparison().negativeControlConceptSet.removeAll();
                self.cohortComparison().negativeControlConceptSetSQL(null);
			}
            
			self.choosePsExclusion = function () {
				$('cohort-comparison-manager #modalConceptSet').modal('show');
                self.targetId = self.cohortComparison().psExclusionId;
				self.targetCaption = self.cohortComparison().psExclusionCaption;
                self.targetExpression = self.cohortComparison().psExclusionConceptSet;
                self.targetConceptIds = self.cohortComparison().psExclusionConceptSetSQL;
			}
			
            self.choosePsInclusion = function () {
				$('cohort-comparison-manager #modalConceptSet').modal('show');
                self.targetId = self.cohortComparison().psInclusionId;
				self.targetCaption = self.cohortComparison().psInclusionCaption;
                self.targetExpression = self.cohortComparison().psInclusionConceptSet;
                self.targetConceptIds = self.cohortComparison().psInclusionConceptSetSQL;
			}

            self.chooseOmExclusion = function () {
				$('cohort-comparison-manager #modalConceptSet').modal('show');
                self.targetId = self.cohortComparison().omExclusionId;
				self.targetCaption = self.cohortComparison().omExclusionCaption;
                self.targetExpression = self.cohortComparison().omExclusionConceptSet;
                self.targetConceptIds = self.cohortComparison().omExclusionConceptSetSQL;
			}
			
            self.chooseOmInclusion = function () {
				$('cohort-comparison-manager #modalConceptSet').modal('show');
                self.targetId = self.cohortComparison().omInclusionId;
				self.targetCaption = self.cohortComparison().omInclusionCaption;
                self.targetExpression = self.cohortComparison().omInclusionConceptSet;
                self.targetConceptIds = self.cohortComparison().omInclusionConceptSetSQL;
			}
            
            self.chooseNegativeControl= function () {
				$('cohort-comparison-manager #modalConceptSet').modal('show');
                self.targetId = self.cohortComparison().negativeControlId;
				self.targetCaption = self.cohortComparison().negativeControlCaption;
                self.targetExpression = self.cohortComparison().negativeControlConceptSet;
                self.targetConceptIds = self.cohortComparison().negativeControlConceptSetSQL;
			}

			self.chooseConceptSet = function (conceptSetType, observable) {
				self.targetObservable = observable;
				$('cohort-comparison-manager #modalConceptSet').modal('show');
			}

			self.isHistoryVisible = function (d) {
				return "fa fa-angle-double-down";
			}

			self.monitorJobExecution = function (jobExecutionId, sourceKey) {
				setTimeout(function () {
					$.ajax({
						url: config.services[0].url + 'job/execution/' + jobExecutionId,
						method: 'GET',
						contentType: 'application/json',
						success: function (d) {
							if (d.status == 'COMPLETED') {
								completed = true;
								self.sourceProcessingStatus[sourceKey](false);
								self.loadExecutions();
							} else {
								self.monitorJobExecution(jobExecutionId, sourceKey);
							}
						}
					});
				}, 10000);
			}

			self.executeCohortComparison = function (sourceKey) {
				self.sourceProcessingStatus[sourceKey](true);

				var generatePromise = $.ajax({
					url: config.services[0].url + 'comparativecohortanalysis/' + self.cohortComparisonId() + '/execute/' + sourceKey,
					method: 'GET',
					contentType: 'application/json',
					success: function (c, status, xhr) {
						self.monitorJobExecution(c.executionId, sourceKey);
					}
				});
			};
            
			if (self.cohortComparisonId() == 0) {
				self.cohortComparison(new ComparativeCohortAnalysis());
                self.cohortComparisonDirtyFlag(new ohdsiUtil.dirtyFlag(self.cohortComparison()));
				self.loading(false);
			} else {
				$.ajax({
					url: config.services[0].url + 'comparativecohortanalysis/' + self.cohortComparisonId(),
					method: 'GET',
					contentType: 'application/json',
					success: function (comparativeCohortAnalysis) {
						self.cohortComparison(new ComparativeCohortAnalysis(comparativeCohortAnalysis));
                        treatmentPromise = $.Deferred();
                        comparatorPromise = $.Deferred();
                        outcomePromise = $.Deferred();
                        
                        // Load up the cohort definitions
                        // Treatment
                        if (self.cohortComparison().treatmentId() != null) {
                            treatmentPromise = cohortDefinitionAPI.getCohortDefinition(self.cohortComparison().treatmentId()).then(function (cohortDefinition) {
                                 cohortDefinition.expression = JSON.parse(cohortDefinition.expression);
                                 self.cohortComparison().treatmentCohortDefinition(new CohortDefinition(cohortDefinition));
                            });
                        } else {
                            treatmentPromise.resolve();
                        }

                        // Comparator
                        if (self.cohortComparison().comparatorId() != null) {
                            comparatorPromise = cohortDefinitionAPI.getCohortDefinition(self.cohortComparison().comparatorId()).then(function (cohortDefinition) {
                                 cohortDefinition.expression = JSON.parse(cohortDefinition.expression);
                                 self.cohortComparison().comparatorCohortDefinition(new CohortDefinition(cohortDefinition));
                            });
                        } else {
                            comparatorPromise.resolve();
                        }

                        // Outcome
                        if (self.cohortComparison().outcomeId() != null) {
                            outcomePromise = cohortDefinitionAPI.getCohortDefinition(self.cohortComparison().outcomeId()).then(function (cohortDefinition) {
                                 cohortDefinition.expression = JSON.parse(cohortDefinition.expression);
                                 self.cohortComparison().outcomeCohortDefinition(new CohortDefinition(cohortDefinition));
                            });
                        } else {
                            outcomePromise.resolve();
                        }
                        
                        // Load up the concept sets
                        // PS Inclusion Concepts
                        if (self.cohortComparison().psInclusionId() > 0) {
                            var conceptSetData = {
                                id: self.cohortComparison().psInclusionId(), 
                                name: self.cohortComparison().psInclusionCaption(), 
                                expression: comparativeCohortAnalysis.psInclusionConceptSet
                            };
                            self.cohortComparison().psInclusionConceptSet.removeAll();
                            self.cohortComparison().psInclusionConceptSet.push(new ConceptSet(conceptSetData));
                        }

                        // PS Exclusion Concepts
                        if (self.cohortComparison().psExclusionId() > 0) {
                            var conceptSetData = {
                                id: self.cohortComparison().psExclusionId(), 
                                name: self.cohortComparison().psExclusionCaption(), 
                                expression: comparativeCohortAnalysis.psExclusionConceptSet
                            };
                            self.cohortComparison().psExclusionConceptSet.removeAll();
                            self.cohortComparison().psExclusionConceptSet.push(new ConceptSet(conceptSetData));
                        }
                        
                        // OM Inclusion Concepts
                        if (self.cohortComparison().omInclusionId() > 0) {
                            var conceptSetData = {
                                id: self.cohortComparison().omInclusionId(), 
                                name: self.cohortComparison().omInclusionCaption(), 
                                expression: comparativeCohortAnalysis.omInclusionConceptSet
                            };
                            self.cohortComparison().omInclusionConceptSet.removeAll();
                            self.cohortComparison().omInclusionConceptSet.push(new ConceptSet(conceptSetData));
                        }

                        // OM Exclusion Concepts
                        if (self.cohortComparison().omExclusionId() > 0) {
                            var conceptSetData = {
                                id: self.cohortComparison().omExclusionId(), 
                                name: self.cohortComparison().omExclusionCaption(), 
                                expression: comparativeCohortAnalysis.omExclusionConceptSet
                            };
                            self.cohortComparison().omExclusionConceptSet.removeAll();
                            self.cohortComparison().omExclusionConceptSet.push(new ConceptSet(conceptSetData));
                        }

                        // Negative Controls Concepts
                        if (self.cohortComparison().negativeControlId() > 0) {
                            var conceptSetData = {
                                id: self.cohortComparison().negativeControlId(), 
                                name: self.cohortComparison().negativeControlCaption(), 
                                expression: comparativeCohortAnalysis.negativeControlConceptSet
                            };
                            self.cohortComparison().negativeControlConceptSet.removeAll();
                            self.cohortComparison().negativeControlConceptSet.push(new ConceptSet(conceptSetData));
                        }
                        
            
                        $.when(treatmentPromise, 
                               comparatorPromise, 
                               outcomePromise).done(function () {
                            
                            self.loading(false);
                            
                            // Resolve any concept sets against the vocab
                            psInclusionPromise = $.Deferred();
                            psExclusionPromise = $.Deferred();
                            omInclusionPromise = $.Deferred();
                            omExclusionPromise = $.Deferred();
                            ncPromise = $.Deferred();

                            // PS Inclusion Concepts
                            if (self.cohortComparison().psInclusionId() > 0) {
                                psInclusionPromise = vocabularyAPI.getConceptSetExpressionSQL(comparativeCohortAnalysis.psInclusionConceptSet).then(function (data) {
                                    console.log('concept set - psInclusionPromise');  
                                    self.cohortComparison().psInclusionConceptSetSQL(data);
                                });
                            } else {
                                psInclusionPromise.resolve();
                            }

                            // PS Exclusion Concepts
                            if (self.cohortComparison().psExclusionId() > 0) {
                               psExclusionPromise = vocabularyAPI.getConceptSetExpressionSQL(comparativeCohortAnalysis.psExclusionConceptSet).then(function (data) {
                                    console.log('concept set - psExclusionPromise');  
                                    self.cohortComparison().psExclusionConceptSetSQL(data);
                                });
                            } else {
                                psExclusionPromise.resolve();
                            }
                            
                            // OM Inclusion Concepts
                            if (self.cohortComparison().omInclusionId() > 0) {
                              omInclusionPromise = vocabularyAPI.getConceptSetExpressionSQL(comparativeCohortAnalysis.omInclusionConceptSet).then(function (data) {
                                    console.log('concept set - omInclusionPromise');  
                                    self.cohortComparison().omInclusionConceptSetSQL(data);
                                });
                            } else {
                                omInclusionPromise.resolve();
                            }

                            // OM Exclusion Concepts
                            if (self.cohortComparison().omExclusionId() > 0) {
                              omExclusionPromise = vocabularyAPI.getConceptSetExpressionSQL(comparativeCohortAnalysis.omExclusionConceptSet).then(function (data) {
                                    console.log('concept set - omExclusionPromise');
                                    self.cohortComparison().omExclusionConceptSetSQL(data);
                                });
                            } else {
                                omExclusionPromise.resolve();
                            }

                            // Negative Controls Concepts
                            if (self.cohortComparison().negativeControlId() > 0) {
                              ncPromise = vocabularyAPI.getConceptSetExpressionSQL(comparativeCohortAnalysis.negativeControlConceptSet).then(function (data) {
                                    console.log('concept set - ncPromise');
                                    self.cohortComparison().negativeControlConceptSetSQL(data);
                                });
                            } else {
                                ncPromise.resolve();
                            }
                            
                            $.when(psInclusionPromise, 
                                   psExclusionPromise, 
                                   omInclusionPromise,
                                   omExclusionPromise, 
                                   ncPromise).done(function() {
                                self.cohortComparisonDirtyFlag(new ohdsiUtil.dirtyFlag(self.cohortComparison()));
                                console.log('concept sets loaded');
                            });
                        });
					}
				});
			}
		}

		var component = {
			viewModel: cohortComparisonManager,
			template: view
		};

		ko.components.register('cohort-comparison-manager', component);
		return component;
	});