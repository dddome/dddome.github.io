/*

    Copyright 2008 The University of North Carolina at Chapel Hill

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License atthis

            http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.

 */
/*
 * Converts xml schemas to usable json objects, focused on elements and attributes.  Result is a javascript
 * object representing a starting node from the base schema, with recursive relations to all its children
 * and attributes.  The resulting structure can then be used or exported.
 * 
 * Intended for populating forms rather than validation.  Not all restrictions are extracted at this time.
 * 
 * Due to cross browser domain restrictions on ajax calls, the schema and its imports must all
 * be stored within the same domain as this script.
 * 
 * @author Ben Pennell
 */
;
function Xsd2Json(xsd, options, imports, namespaceIndexes) {
	var defaults = {
		schemaURI: "",
		rootElement: null,
		generateRoot: false,
		isImported : false
	};
	this.options = $.extend({}, defaults, options);
	this.xsNS = "http://www.w3.org/2001/XMLSchema";
	this.xsPrefix = "xs:";
	this.xsd = null;
	if (imports)
		this.imports = imports;
	else this.imports = {};
	// Object definitions defined at the root level of the schema
	this.rootDefinitions = {};
	this.types = {};
	// Shared namespace index registry, used by all schemas being processed
	this.namespaceIndexes = namespaceIndexes? namespaceIndexes : [];
	// Local namespace prefix registry
	this.namespaces = {};
	// Registering the "special" namespaces that are automatically added by web browsers
	this.registerNamespace("http://www.w3.org/XML/1998/namespace", "xml");
	this.registerNamespace("http://www.w3.org/2000/xmlns/", "xmlns");
	this.registerNamespace("http://www.w3.org/1999/xhtml/", "html");
	// The target namespace for this schema
	this.targetNS = null;
	// The index of the target namespace in namespaceIndexes
	this.targetNSIndex = null;
	this.root = null;
	
	//if (xsd instanceof File){
		// Not implemented yet
		//var self = this;
		/*var reader = new FileReader();
		reader.onload = (function(theFile) {
	        return function(e) {
	        	self.xsd = $($($.parseXML(e.target.result)).children("xs:schema")[0]);
	        	var selected = self.xsd.children("xs|element[name='" + self.topLevelName + "']").first();
	        	this.root = self.buildElement(selected);
	        };
	      })(xsd);
		
		reader.readAsText(xsd);*/
	//} else {
		this.importAjax(xsd, false);
	//}
};

Xsd2Json.prototype.importAjax = function(url, originalAttempt) {
	var originalURL = url;
	// Prefer a local copy to the remote since likely can't get the remote copy due to cross domain ajax restrictions
	if (!originalAttempt)
		url = this.options.schemaURI + url.substring(url.lastIndexOf("/") + 1);
	var self = this;
	$.ajax({
		url: url,
		dataType: "text",
		async: false,
		success: function(data){
			self.xsd = $.parseXML(data).documentElement;
			self.processSchema();
		}, error: function() {
			if (!originalAttempt)
				throw new Error("Unable to import " + url);
			self.importAjax(originalURL, true);
		}
	});
};

// Retrieve all the children of node which belong to the schema namespace.  
// If they are specified, then the results will be filtered to only include children which
// match the given element name and/or have a name attribute of the given value
// filtered to
Xsd2Json.prototype.getChildren = function(node, childName, nameAttribute) {
	var children = [];
	if (!node)
		node = this.xsd;
	var childNameSpecified = childName !== undefined;
	var attributeSpecified = nameAttribute !== undefined;
	var childNodes = node.childNodes;
	for (var index in childNodes) {
		var child = childNodes[index];
		if (child.nodeType == 1 && child.namespaceURI == this.xsNS && 
				((childNameSpecified && child.localName == childName) || (!childNameSpecified && child.localName != 'annotation')) &&
				(!attributeSpecified || child.getAttribute('name') == nameAttribute))
			children.push(child);
	}
	return children;
}

// Namespace aware check to see if a definition already contains parent child element
Xsd2Json.prototype.containsChild = function(object, child) {
	if (object.elements) {
		for (var index in object.elements) {
			if (object.elements[index].name == child.name
					&& object.elements[index].ns == child.ns)
				return true;
		}
	}
	return false;
};

// Register a namespace, and optionally its prefix, to the schema
Xsd2Json.prototype.registerNamespace = function(namespaceUri, prefix) {
	if ($.inArray(namespaceUri, this.namespaceIndexes) == -1)
		this.namespaceIndexes.push(namespaceUri);
	if (prefix !== undefined)
		this.namespaces[prefix] = namespaceUri;
};

// Process the schema file
Xsd2Json.prototype.processSchema = function() {
	var self = this;
	// Extract all the namespaces in use by this schema
	for (var i = 0; i < this.xsd.attributes.length; i++) {
		var attr = this.xsd.attributes[i];
		if (!attr.specified)
			continue;
		var namespaceIndex = attr.nodeName.indexOf("xmlns");
		if (namespaceIndex == 0){
			var namespacePrefix = attr.nodeName.substring(5).replace(":", "");
			var namespaceUri = attr.nodeValue;
			this.registerNamespace(namespaceUri, namespacePrefix);
			// Store the namespace prefix for the xs namespace
			if (attr.nodeValue == self.xsNS){
				self.xsPrefix = namespacePrefix;
				if (self.xsPrefix != "")
					self.xsPrefix = self.xsPrefix + ":";
			}
		}
	}
	// Store the target namespace of this schema.
	this.targetNS = this.xsd.getAttribute("targetNamespace");
	this.targetNSIndex = $.inArray(this.targetNS, this.namespaceIndexes);
	// Load all of the imported schemas
	var imports = this.getChildren(this.xsd, 'import');
	this.imports[this.targetNS] = this;
	for (var index in imports) {
		var importNode = imports[index];
		var importNamespace = importNode.getAttribute('namespace');
		if (importNamespace in this.imports) {
			// Circular import or already imported by another schema
		} else {
			new Xsd2Json(importNode.getAttribute("schemaLocation"), 
					$.extend({}, self.options, {
						rootElement: null, 
						isImported : true
					}), this.imports, this.namespaceIndexes);
		}
	}
	// Begin constructing the element tree, either from a root element or the schema element
	var selected = null;
	if (this.options.rootElement != null)
		selected = this.getChildren(this.xsd, "element", this.options.rootElement)[0];
	else selected = this.xsd;
	try {
		this.processingStarted = true;
		if (this.options.rootElement != null)
			this.root = this.buildElement(selected);
		else this.root = this.buildSchema(selected);
		// Resolve dangling type references
		this.resolveTypeReferences(this.root, []);
		// Only do this block for the root schema
		if (!this.options.isImported) {
			// Resolve dangling external schema types from circular includes
			this.resolveCrossSchemaTypeReferences(this.root, []);
			// Add all the namespaces from imported schemas into the registry of namespaces for the root schema
			var namespaceRegistry = [];
			for (var index in this.namespaceIndexes) {
				var namespaceUri = this.namespaceIndexes[index];
				$.each(this.namespaces, function(key, val){
					if (val == namespaceUri) {
						namespaceRegistry.push({'prefix' : key, 'uri' : val});
						return false;
					}
				});
			}
			this.root.namespaces = namespaceRegistry;
		}
	} catch (e) {
		console.log(e);
	}
};

// Post processing step which recursively walks the schema tree and merges type definitions
// into elements that reference them.
Xsd2Json.prototype.resolveTypeReferences = function(object, objectStack) {
	if (object.typeRef == null) {
		// Since this object did not have a type reference, continue to walk its children
		if (object.element || object.schema) {
			var self = this;
			if (object.elements) {
				objectStack.push(object);
				$.each(object.elements, function(){
					if ($.inArray(this, objectStack) == -1)
						self.resolveTypeReferences(this, objectStack);
				});
				objectStack.pop();
			}
			if (object.attributes != null) {
				$.each(object.attributes, function(){
					self.resolveTypeReferences(this);
				});
			}
		}
	} else {
		// If there was a type definition on this object, merge it in and stop to avoid infinite loops
		var typeDef = object.typeRef;
		delete object.typeRef;
		this.mergeType(object, typeDef);
	}
};

// Detect if the given object referenced a type from a schema which was not available at the time
// it was originally being processed.  If so, then merge the definition with the definition from
// the external schema.
Xsd2Json.prototype.mergeCrossSchemaType = function(object) {
	if (object.schemaObject) {
		var schemas = object.schemaObject;
		var references = object.reference;
		// Clean up the cross schema references
		delete object.schemaObject;
		delete object.reference;
		// Merge in the external schema types, recursively merging together the external schema types
		for (var i = 0; i < schemas.length; i++){
			this.mergeType(object, this.mergeCrossSchemaType(schemas[i].rootDefinitions[references[i]]));
		}
	}
	return object;
};

// Walk the schema tree to resolve dangling cross schema definitions, which are created as stubs 
// when circular schema includes are detected.
// This is only performed once ALL schemas have been processed and local types resolved
Xsd2Json.prototype.resolveCrossSchemaTypeReferences = function(object, objectStack) {
	this.mergeCrossSchemaType(object);
	if (object.element || object.schema) {
		if (object.elements) {
			objectStack.push(object);
			for (var i in object.elements) 
				if ($.inArray(object.elements[i], objectStack) == -1)
					this.resolveCrossSchemaTypeReferences(object.elements[i], objectStack);
			objectStack.pop();
		}
		// Resolve attribute definitions
		for (var i in object.attributes) 
			this.resolveCrossSchemaTypeReferences(object.attributes[i]);
	}
};

// Build the schema tag
Xsd2Json.prototype.buildSchema = function(node) {
	var object = {
		"elements": [],
		"ns": this.targetNSIndex,
		"schema": true
	};
	var self = this;
	var children = this.getChildren(node);
	for (var i in children) {
		var child = children[i];
		if (child.localName == 'element')
			this.buildElement(child, object);
	}
	return object;
};

// Build an element definition
// node - element schema node
// parentObject - definition of the parent this element will be added to
Xsd2Json.prototype.buildElement = function(node, parentObject) {
	var definition = null;
	var name = node.getAttribute("name");
	var nameParts = this.extractName(name);
	var parentIsSchema = node.parentNode === this.xsd;
	
	if (parentIsSchema) {
		// Detect if this element is already defined in the list of root definitions, if so use that
		if (nameParts && nameParts.indexedName in this.rootDefinitions)
			return this.rootDefinitions[nameParts.indexedName];
	} else {
		// Store min/max occurs on the the elements parent, as they only apply to this particular relationship
		// Root level elements can't have min/max occurs attributes
		var minOccurs = node.getAttribute("minOccurs");
		var maxOccurs = node.getAttribute("maxOccurs");
		if (parentObject && (minOccurs || maxOccurs)) {
			var nameOrRefParts = nameParts? nameParts : this.extractName(node.getAttribute("ref"));
			if (!("occurs" in parentObject))
				parentObject.occurs = {};
			parentObject.occurs[nameOrRefParts.indexedName] = {
					'min' : minOccurs,
					'max' : maxOccurs
			};
		}
	}
	
	var hasSubGroup = node.getAttribute("substitutionGroup") != null;
	var hasRef = node.getAttribute("ref") != null;
	if (hasSubGroup || hasRef){
		// Resolve reference to get the actual definition for this element
		definition = this.execute(node, 'buildElement', parentObject);
		if (hasSubGroup) {
			definition = $.extend({}, definition, {'name' : nameParts.localName});
			if (node.parentNode === this.xsd && !hasRef) {
				this.rootDefinitions[nameParts.indexedName] = definition;
			}
		}
	} else {
		// Element has a name, means its a new element
		definition = {
				"name" : nameParts.localName,
				"elements": [],
				"attributes": [],
				"values": [],
				"type": null,
				"ns": this.targetNSIndex,
				"element": true
		};
		
		// If this is a root level element, store it in rootDefinition
		if (parentIsSchema) {
			this.rootDefinitions[nameParts.indexedName] = definition;
		}
		
		// Build or retrieve the type definition
		var type = node.getAttribute("type");
		if (type == null) {
			this.buildType(this.getChildren(node)[0], definition);
		} else {
			definition.type = this.resolveType(type, definition);
			if (definition.type == null) {
				var typeDef = this.execute(node, 'buildType', definition);
				// If there was a previously defined type, then store a reference to it
				if (typeDef !== undefined) {
					definition.typeRef = typeDef;
				}
			}
		}
	}
	
	// Add this element as a child of the parent, unless it is abstract or already added
	if (parentObject != null && node.getAttribute("abstract") != "true")
		if (!hasRef || (hasRef && !this.containsChild(parentObject, definition)))
			parentObject.elements.push(definition);
	
	return definition;
}

Xsd2Json.prototype.buildAttribute = function(node, parentObject) {
	var definition = null;
	var name = node.getAttribute("name");
	var nameParts;
	
	var hasRef = node.getAttribute("ref") != null;
	if (hasRef){
		// Follow reference to get the actual type definition
		definition = this.execute(node, 'buildAttribute');
	} else {
		// Actual attribute definition, build new definition
		nameParts = this.extractName(name);
		definition = {
				"name" : nameParts.localName,
				"values": [],
				"ns": this.targetNSIndex,
				"attribute": true
			};
		
		var type = node.getAttribute("type");
		if (type == null) {
			this.buildType(this.getChildren(node)[0], definition);
		} else {
			definition.type = this.resolveType(type, definition);
			if (definition.type == null) {
				var typeDef = this.execute(node, 'buildType', definition);
				// If there was a previously defined type, then store a reference to it
				if (typeDef !== undefined) {
					definition.typeRef = typeDef;
				}
			}
		}
	}
	
	// Store the definition to rootDefinitions if it was defined at the root of the schema
	if (node.parentNode === this.xsd && !hasRef) {
		this.rootDefinitions[nameParts.indexedName] = definition;
	}
	
	// Add the definition to its parents attributes array
	if (parentObject != null)
		parentObject.attributes.push(definition);
	
	return definition;
};

// Build a type definition
Xsd2Json.prototype.buildType = function(node, object) {
	if (node == null)
		return;
	
	var needsMerge = false;
	var extendingObject = object;
	var name = node.getAttribute("name");
	if (name != null){
		var nameParts = this.extractName(name);
		// If this type has already been processed, then apply it
		if (nameParts.indexedName in this.rootDefinitions) {
			this.mergeType(object, this.types[nameParts.indexedName]);
			return;
		}
		// New type, create base
		var type = {
				elements: [],
				attributes: [],
				values: [],
				ns: this.targetNSIndex
			};
		this.rootDefinitions[nameParts.indexedName] = type;
		//this.types[name] = type;
		extendingObject = type;
		needsMerge = true;
	}
	
	// Determine what kind of type this is
	if (node.localName == "complexType") {
		this.buildComplexType(node, extendingObject);
	} else if (node.localName == "simpleType") {
		this.buildSimpleType(node, extendingObject);
	} else if (node.localName == "restriction") {
		this.buildRestriction(node, extendingObject);
	}
	
	// Only need to merge if creating a new named type definition
	if (needsMerge) {
		this.mergeType(object, extendingObject);
	}
};

// Process a complexType tag
Xsd2Json.prototype.buildComplexType = function(node, object) {
	var self = this;
	if (node.getAttribute("mixed") == "true") {
		object.type = "mixed";
	}
	var children = this.getChildren(node);
	for (var i in children) {
		var child = children[i];
		if (child.localName == "group") {
			self.execute(child, 'buildGroup', object);
		} else if (child.localName == "simpleContent") {
			self.buildSimpleContent(child, object);
		} else if (child.localName == "complexContent") {
			self.buildComplexContent(child, object);
		} else if (child.localName == "choice") {
			self.buildChoice(child, object);
		} else if (child.localName == "attribute") {
			self.buildAttribute(child, object);
		} else if (child.localName == "attributeGroup") {
			self.execute(child, 'buildAttributeGroup', object);
		} else if (child.localName == "sequence") {
			self.buildSequence(child, object);
		} else if (child.localName == "all") {
			self.buildAll(child, object);
		}
	}
};

// Process a simpleType tag
Xsd2Json.prototype.buildSimpleType = function(node, object) {
	var child = this.getChildren(node)[0];
	if (child.localName == "restriction") {
		this.buildRestriction(child, object);
	} else if (child.localName == "list") {
		this.buildList(child, object);
	} else if (child.localName == "union") {
		this.buildUnion(child, object);
	}
};

// Process a list tag
Xsd2Json.prototype.buildList = function(node, object) {
	var itemType = node.getAttribute('itemType');
	object.type = this.resolveType(itemType, object);
	if (object.type == null) {
		this.execute(node, 'buildType', object);
	}
	object.multivalued = true;
};

// Process a union tag
Xsd2Json.prototype.buildUnion = function(node, object) {
	var memberTypes = node.getAttribute('memberTypes');
	if (memberTypes) {
		memberTypes = memberTypes.split(' ');
		var self = this;
		for (var i in memberTypes) {
			var memberType = memberTypes[i];
			var xsdObj = self.resolveXSD(memberType);
			var targetNode = xsdObj.getChildren(null, 'simpleType', memberType)[0];
			xsdObj.buildType(targetNode, object);
		}
	}
	var self = this;
	var children = this.getChildren(node, 'simpleType');
	for (var i in children)
		self.buildSimpleType(children[i], object);
};

// Process a group tag
Xsd2Json.prototype.buildGroup = function(node, object) {
	var self = this;
	var children = this.getChildren(node);
	for (var i in children) {
		var child = children[i];
		if (child.localName == "choice")  {
			self.buildChoice(child, object);
		} else if (child.localName == "all") {
			self.buildAll(child, object);
		} else if (child.localName == "sequence") {
			self.buildSequence(child, object);
		}
	}
};

// Process an all tag
Xsd2Json.prototype.buildAll = function(node, object) {
	var self = this;
	var children = this.getChildren(node);
	for (var i in children) {
		var child = children[i];
		if (child.localName == "element") {
			self.buildElement(child, object);
		}
	}
};

// Process a choice tag
Xsd2Json.prototype.buildChoice = function(node, object) {
	var self = this;
	var choice = {
			"elements": [],
			"minOccurs": node.getAttribute("minOccurs"),
			"maxOccurs": node.getAttribute("maxOccurs")
	};
	var children = this.getChildren(node);
	for (var i in children) {
		var child = children[i];
		if (child.localName == "element") {
			var element = self.buildElement(child, object);
			choice.elements.push(element.ns + ":" + element.name);
		} else if (child.localName == "group") {
			self.execute(child, 'buildGroup', object);
		} else if (child.localName == "choice") {
			self.buildChoice(child, object);
		} else if (child.localName == "sequence") {
			self.buildSequence(child, object);
		} else if (child.localName == "any") {
			self.buildAny(child, object);
		}
	}
	if (!('choices' in object))
		object.choices = [];
	object.choices.push(choice);
};

// Process a sequence tag
Xsd2Json.prototype.buildSequence = function(node, object) {
	var self = this;
	var children = this.getChildren(node);
	for (var i in children) {
		var child = children[i];
		if (child.localName == "element") {
			self.buildElement(child, object);
		} else if (child.localName == "group") {
			self.execute(child, 'buildGroup', object);
		} else if (child.localName == "choice") {
			self.buildChoice(child, object);
		} else if (child.localName == "sequence") {
			self.buildSequence(child, object);
		} else if (child.localName == "any") {
			self.buildAny(child, object);
		}
	}
};

// Process an any tag
Xsd2Json.prototype.buildAny = function(node, object) {
	object.any = !(node.getAttribute("minOccurs") == "0" && node.getAttribute("maxOccurs") == "0");
};

// Process a complexContent tag
Xsd2Json.prototype.buildComplexContent = function(node, object) {
	if (node.getAttribute("mixed") == "true") {
		object.type = "mixed";
	}
	
	var child = this.getChildren(node)[0];
	if (child.localName == "extension") {
		this.buildExtension(child, object);
	} else if (child.localName == "restriction") {
		this.buildRestriction(child, object);
	}
};

// Process a simpleContent tag
Xsd2Json.prototype.buildSimpleContent = function(node, object) {
	var child = this.getChildren(node)[0];
	if (child.localName == "extension") {
		this.buildExtension(child, object);
	} else if (child.localName == "restriction") {
		this.buildRestriction(child, object);
	}
};

// Process a restriction tag
Xsd2Json.prototype.buildRestriction = function(node, object) {
	var base = node.getAttribute("base");
	
	object.type = this.resolveType(base, object);
	if (object.type == null) {
		var typeDef = this.execute(node, 'buildType', object);
		if (typeDef !== undefined)
			this.mergeType(object, typeDef);
	}
	var self = this;
	var children = this.getChildren(node);
	for (var i in children) {
		var child = children[i];
		if (child.localName == "enumeration") {
			object.values.push(child.getAttribute("value"));
		} else if (child.localName == "group") {
			self.execute(child, 'buildGroup', object);
		} else if (child.localName == "choice") {
			self.buildChoice(child, object);
		} else if (child.localName == "attribute") {
			self.buildAttribute(child, object);
		} else if (child.localName == "attributeGroup") {
			self.execute(child, 'buildAttributeGroup', object);
		} else if (child.localName == "sequence") {
			self.buildSequence(child, object);
		} else if (child.localName == "all") {
			self.buildAll(child, object);
		} else if (child.localName == "simpleType") {
			self.buildSimpleType(child, object);
		}
	}
};

// Process an extension tag
Xsd2Json.prototype.buildExtension = function(node, object) {
	var base = node.getAttribute("base");
	
	object.type = this.resolveType(base, object);
	if (object.type == null) {
		var typeDef = this.execute(node, 'buildType', object);
		if (typeDef !== undefined)
			this.mergeType(object, typeDef);
	}
	var self = this;
	var children = this.getChildren(node);
	for (var i in children) {
		var child = children[i];
		if (child.localName == "attribute") {
			self.buildAttribute(child, object);
		} else if (child.localName == "attributeGroup") {
			self.execute(child, 'buildAttributeGroup', object);
		} else if (child.localName == "sequence") {
			self.buildSequence(child, object);
		} else if (child.localName == "all") {
			self.buildAll(child, object);
		} else if (child.localName == "choice") {
			self.buildChoice(child, object);
		} else if (child.localName == "group") {
			self.buildGroup(child, object);
		}
	}
};

// Process an attributeGroup tag
Xsd2Json.prototype.buildAttributeGroup = function(node, object) {
	var children = this.getChildren(node);
	for (var i in children) {
		var child = children[i];
		if (child.localName == "attribute") {
			this.buildAttribute(child, object);
		} else if (child.localName == "attributeGroup") {
			this.execute(child, 'buildAttributeGroup', object);
		}
	}
};

// Process a node with tag processing functin fnName.  Follows references on the node,
// determining which schema object will be responsible for generating the definition.
// node - the node being processed
// fnName - the function to be called to process the node
// object - definition object the node belongs to
Xsd2Json.prototype.execute = function(node, fnName, object) {
	var resolveName = node.getAttribute("ref") || node.getAttribute("substitutionGroup") 
			|| node.getAttribute("type") || node.getAttribute("base");
	var targetNode = node;
	var xsdObj = this;
	var name = resolveName;
	// Determine if the node requires resolution to another definition node
	if (resolveName != null && (this.xsPrefix == "" && resolveName.indexOf(":") != -1) 
			|| (this.xsPrefix != "" && resolveName.indexOf(this.xsPrefix) == -1)) {
		// Determine which schema the reference belongs to
		xsdObj = this.resolveXSD(resolveName);
		var nameParts = this.extractName(name);
		//Check for cached version of the definition
		if (nameParts.indexedName in xsdObj.rootDefinitions){
			var definition = xsdObj.rootDefinitions[nameParts.indexedName];
			if (definition != null) {
				return definition;
			}
		}
		// Schema reference is not initialized yet, therefore it is a circular reference, store stub
		if (!xsdObj.processingStarted && xsdObj !== this)
			return {name: nameParts.indexedName, schemaObject : [xsdObj], reference : [nameParts.indexedName]};
		// Grab the node the reference was referring to
		targetNode = xsdObj.getChildren(xsdObj.xsd, undefined, nameParts.localName)[0];
	} 
	
	try {
		// Call the processing function on the referenced node
		return xsdObj[fnName](targetNode, object);
	} catch (error) {
		$("body").append("<br/>" + name + ": " + error + " ");
		throw error;
	}
};

Xsd2Json.prototype.stripPrefix = function(name) {
	var index = name.indexOf(":");
	return index == -1? name: name.substring(index + 1);
};

Xsd2Json.prototype.resolveXSD = function(name) {
	if (name != null){
		var index = name.indexOf(":");
		var prefix = index == -1? null: name.substring(0, index);
		var namespace = this.namespaces[prefix];
		var xsdObj = this.imports[namespace];
		if (xsdObj == null)
			xsdObj = this;
		return xsdObj;
	}
	return this;
};

Xsd2Json.prototype.resolveType = function(type, object) {
	if (object.type != null)
		return object.type;
	if (type.indexOf(":") == -1) {
		if (this.xsPrefix == "")
			return type;
	} else {
		if (type.indexOf(this.xsPrefix) == 0){
			return type.substring(this.xsPrefix.length);
		}
	}
	return null;
};

Xsd2Json.prototype.mergeType = function(base, type) {
	for (var key in type) {
		if (type.hasOwnProperty(key)) {
			var value = type[key];
			if (value != null && base[key] == null){
				base[key] = value;
			} else if ($.isArray(value) && $.isArray(type[key])){
				base[key] = base[key].concat(value);
			}
		}
	}
};

Xsd2Json.prototype.extractName = function(name) {
	if (!name)
		return null;
	var result = {};
	var index = name.indexOf(':');
	var prefix, localName;
	if (index == -1) {
		result['localName'] = name;
		result['prefix'] = "";
	} else {
		result['localName'] = name.substring(index + 1);
		result['prefix'] = name.substring(0, index);
	}
	result['namespace'] = $.inArray(this.namespaces[result.prefix], this.namespaceIndexes);
	result['indexedName'] = result.namespace + ":" + result.localName;
	return result;
};

Xsd2Json.prototype.getSchema = function() {
	var self = this;
	return function() {return self.root;};
};

/**
 * Converts the computed schema object into JSON and returns as a string.  If pretty is
 * true, then the json will use pretty formatting.
 * @param pretty
 * @returns
 */
Xsd2Json.prototype.stringify = function(pretty) {
	if (this.root == null)
		throw new Error("Root element was not set, cannot convert to JSON.");
	if (pretty) {
		return vkbeautify.json(JSON.stringify(JSON.decycle(this.root)));
	}
	return JSON.stringify(JSON.decycle(this.root));
};

/**
 * Creates a file named <filename> from the computed schema object, converted to JSON.
 * If variableName is provided, then the JSON will be output so that it is assigned to a variable of
 * the same name in the exported JSON file.  Allows for caching to a file without needing to use eval to reload.
 * If pretty is provided, the json will use pretty formatting.
 * @param filename
 * @param variableName
 * @param pretty
 * @returns {Boolean}
 */
Xsd2Json.prototype.exportJSON = function(filename, variableName, pretty) {
	// JSON versus JS
	window.URL = window.webkitURL || window.URL;
	window.BlobBuilder = window.BlobBuilder || window.WebKitBlobBuilder || window.MozBlobBuilder || window.MSBlobBuilder;
	
	if (window.BlobBuilder === undefined) {
		alert("Browser does not support saving files.");
		return false;
	}
	
	var jsonString = this.stringify(pretty);
	if (variableName != null){
		jsonString = "var " + variableName + " = " + jsonString + ";";
	}
	var blobBuilder = new BlobBuilder();
	blobBuilder.append(jsonString);
	
	var mimeType = "application/json";
	
	var a = document.createElement('a');
	a.download = filename;
	a.href = window.URL.createObjectURL(blobBuilder.getBlob(mimeType));
	
	a.dataset.downloadurl = [mimeType, a.download, a.href].join(':');
	a.target = "exportJSON";
	
	var event = document.createEvent("MouseEvents");
	event.initMouseEvent(
		"click", true, false, window, 0, 0, 0, 0, 0
		, false, false, false, false, 0, null
	);
	a.dispatchEvent(event);
};