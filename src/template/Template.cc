/* -------------------------------------------------------------------------- */
/* Copyright 2002-2017, OpenNebula Project, OpenNebula Systems                */
/*                                                                            */
/* Licensed under the Apache License, Version 2.0 (the "License"); you may    */
/* not use this file except in compliance with the License. You may obtain    */
/* a copy of the License at                                                   */
/*                                                                            */
/* http://www.apache.org/licenses/LICENSE-2.0                                 */
/*                                                                            */
/* Unless required by applicable law or agreed to in writing, software        */
/* distributed under the License is distributed on an "AS IS" BASIS,          */
/* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.   */
/* See the License for the specific language governing permissions and        */
/* limitations under the License.                                             */
/* -------------------------------------------------------------------------- */

#include "Template.h"
#include "template_syntax.h"
#include "NebulaUtil.h"

#include <iostream>
#include <sstream>
#include <cstring>
#include <cstdio>

/* -------------------------------------------------------------------------- */
/* -------------------------------------------------------------------------- */

Template::~Template()
{
    multimap<string,Attribute *>::iterator  it;

    for ( it = attributes.begin(); it != attributes.end(); it++)
    {
        delete it->second;
    }
}

/* -------------------------------------------------------------------------- */
/* -------------------------------------------------------------------------- */

pthread_mutex_t Template::mutex = PTHREAD_MUTEX_INITIALIZER;

extern "C"
{
    typedef struct yy_buffer_state * YY_BUFFER_STATE;

    extern FILE *template_in, *template_out;

    int template_parse(Template * tmpl, char ** errmsg);

    int template_lex_destroy();

    YY_BUFFER_STATE template__scan_string(const char * str);

    void template__delete_buffer(YY_BUFFER_STATE);
}

/* -------------------------------------------------------------------------- */
/* -------------------------------------------------------------------------- */

int Template::parse(const char * filename, char **error_msg)
{
    int     rc;

    pthread_mutex_lock(&mutex);

    *error_msg = 0;

    template_in = fopen (filename, "r");

    if ( template_in == 0 )
    {
        goto error_open;
    }

    rc = template_parse(this,error_msg);

    fclose(template_in);

    template_lex_destroy();

    pthread_mutex_unlock(&mutex);

    return rc;

error_open:
    *error_msg = strdup("Error opening template file");

    pthread_mutex_unlock(&mutex);

    return -1;
}

/* -------------------------------------------------------------------------- */
/* -------------------------------------------------------------------------- */

int Template::parse(const string &parse_str, char **error_msg)
{
    YY_BUFFER_STATE     str_buffer = 0;
    const char *        str;
    int                 rc;

    pthread_mutex_lock(&mutex);

    *error_msg = 0;

    str = parse_str.c_str();

    str_buffer = template__scan_string(str);

    if (str_buffer == 0)
    {
        goto error_yy;
    }

    rc = template_parse(this,error_msg);

    template__delete_buffer(str_buffer);

    template_lex_destroy();

    pthread_mutex_unlock(&mutex);

    return rc;

error_yy:

    *error_msg=strdup("Error setting scan buffer");

    pthread_mutex_unlock(&mutex);

    return -1;
}

/* -------------------------------------------------------------------------- */
/* -------------------------------------------------------------------------- */

int Template::parse_str_or_xml(const string &parse_str, string& error_msg)
{
    int     rc;

    if ( parse_str[0] == '<' )
    {
        rc = from_xml(parse_str);

        if ( rc != 0 )
        {
            error_msg = "Parse error: XML Template malformed.";
        }
    }
    else
    {
        char * error_char = 0;

        rc = parse(parse_str, &error_char);

        if ( rc != 0 )
        {
            ostringstream oss;

            oss << "Parse error";

            if (error_char != 0)
            {
                oss << ": " << error_char;

                free(error_char);
            }
            else
            {
                oss << ".";
            }

            error_msg = oss.str();
        }
    }

    if(rc == 0)
    {
        trim_name();
    }

    return rc;
}

/* -------------------------------------------------------------------------- */
/* -------------------------------------------------------------------------- */

void Template::marshall(string &str, const char delim)
{
    multimap<string,Attribute *>::iterator  it;
    string *                                attr;

    for(it=attributes.begin(),str="";it!=attributes.end();it++)
    {
        attr = it->second->marshall();

        if ( attr == 0 )
        {
            continue;
        }

        str += it->first + "=" + *attr + delim;

        delete attr;
    }
}

/* -------------------------------------------------------------------------- */
/* -------------------------------------------------------------------------- */

void Template::set(Attribute * attr)
{
    if ( replace_mode == true )
    {
        multimap<string, Attribute *>::iterator         i;
        pair<multimap<string, Attribute *>::iterator,
        multimap<string, Attribute *>::iterator>        index;

        index = attributes.equal_range(attr->name());

        for ( i = index.first; i != index.second; i++)
        {
            delete i->second;
        }

        attributes.erase(attr->name());
    }

    attributes.insert(make_pair(attr->name(),attr));
};

/* -------------------------------------------------------------------------- */
/* -------------------------------------------------------------------------- */

int Template::replace(const string& name, const string& value)
{
    pair<multimap<string, Attribute *>::iterator,
         multimap<string, Attribute *>::iterator>   index;

    index = attributes.equal_range(name);

    if (index.first != index.second )
    {
        multimap<string, Attribute *>::iterator i;

        for ( i = index.first; i != index.second; i++)
        {
            Attribute * attr = i->second;
            delete attr;
        }

        attributes.erase(index.first, index.second);
    }

    SingleAttribute * sattr = new SingleAttribute(name,value);

    attributes.insert(make_pair(sattr->name(), sattr));

    return 0;
}

/* -------------------------------------------------------------------------- */
/* -------------------------------------------------------------------------- */

int Template::replace(const string& name, const bool& value)
{
    string s_val;

    pair<multimap<string, Attribute *>::iterator,
         multimap<string, Attribute *>::iterator>   index;

    index = attributes.equal_range(name);

    if (index.first != index.second )
    {
        multimap<string, Attribute *>::iterator i;

        for ( i = index.first; i != index.second; i++)
        {
            Attribute * attr = i->second;
            delete attr;
        }

        attributes.erase(index.first, index.second);
    }

    if (value)
    {
        s_val = "YES";
    }
    else
    {
        s_val = "NO";
    }

    SingleAttribute * sattr = new SingleAttribute(name, s_val);

    attributes.insert(make_pair(sattr->name(), sattr));

    return 0;
}

/* -------------------------------------------------------------------------- */
/* -------------------------------------------------------------------------- */

int Template::erase(const string& name)
{
    multimap<string, Attribute *>::iterator         i;

    pair<
        multimap<string, Attribute *>::iterator,
        multimap<string, Attribute *>::iterator
        >                                           index;
    int                                             j;

    index = attributes.equal_range(name);

    if (index.first == index.second )
    {
        return 0;
    }

    for ( i = index.first,j=0 ; i != index.second ; i++,j++ )
    {
        Attribute * attr = i->second;
        delete attr;
    }

    attributes.erase(index.first,index.second);

    return j;

}

/* -------------------------------------------------------------------------- */
/* -------------------------------------------------------------------------- */

Attribute * Template::remove(Attribute * att)
{
    multimap<string, Attribute *>::iterator         i;

    pair<
        multimap<string, Attribute *>::iterator,
        multimap<string, Attribute *>::iterator
        >                                           index;

    index = attributes.equal_range( att->name() );

    for ( i = index.first; i != index.second; i++ )
    {
        if ( i->second == att )
        {
            attributes.erase(i);

            return att;
        }
    }

    return 0;
}


/* -------------------------------------------------------------------------- */
/* -------------------------------------------------------------------------- */

bool Template::get(const string& name, string& value) const
{
    const SingleAttribute * s = __get<SingleAttribute>(name);

    if ( s == 0 )
    {
        value = "";
        return false;
    }

    value = s->value();

	return true;
}

/* -------------------------------------------------------------------------- */
/* -------------------------------------------------------------------------- */

bool Template::get(const string& name, bool& value) const
{
    const SingleAttribute * s = __get<SingleAttribute>(name);

    value = false;

    if ( s == 0 )
    {
        return false;
    }

    string sval = s->value();

    if (one_util::toupper(sval) == "YES")
    {
        value = true;
    }

    return true;
}

/* -------------------------------------------------------------------------- */
/* -------------------------------------------------------------------------- */

string& Template::to_xml(string& xml) const
{
    multimap<string,Attribute *>::const_iterator  it;
    ostringstream                           oss;
    string *                                s;

    oss << "<" << xml_root << ">";

    for ( it = attributes.begin(); it!=attributes.end(); it++)
    {
        s = it->second->to_xml();

        oss << *s;

        delete s;
    }

    oss << "</" << xml_root << ">";

    xml = oss.str();

    return xml;
}
/* -------------------------------------------------------------------------- */
/* -------------------------------------------------------------------------- */

string& Template::to_str(string& str) const
{
    ostringstream os;
    multimap<string,Attribute *>::const_iterator  it;
    string *                                s;

    for ( it = attributes.begin(); it!=attributes.end(); it++)
    {
        s = it->second->marshall(",");

        os << it->first << separator << *s << endl;

        delete s;
    }

    str = os.str();
    return str;
}

/* -------------------------------------------------------------------------- */
/* -------------------------------------------------------------------------- */

bool Template::trim(const string& name)
{
    string st;
    get(name, st);

    if(st.empty())
    {
        return false;
    }

    replace(name, st.substr( 0, st.find_last_not_of(" \f\n\r\t\v") + 1 ) );

    return true;
}

/* -------------------------------------------------------------------------- */
/* -------------------------------------------------------------------------- */

ostream& operator << (ostream& os, const Template& t)
{
    string str;

    os << t.to_str(str);

    return os;
}

/* ------------------------------------------------------------------------ */
/* ------------------------------------------------------------------------ */

Attribute * Template::single_xml_att(const xmlNode * node)
{
    Attribute * attr = 0;
    xmlNode *   child = node->children;

    if( child != 0 && child->next == 0 &&
        (child->type == XML_TEXT_NODE ||
         child->type == XML_CDATA_SECTION_NODE))
    {
        attr = new SingleAttribute(
                            reinterpret_cast<const char *>(node->name),
                            reinterpret_cast<const char *>(child->content) );
    }

    return attr;
}

/* ------------------------------------------------------------------------ */
/* ------------------------------------------------------------------------ */

Attribute * Template::vector_xml_att(const xmlNode * node)
{
    VectorAttribute *   attr        = 0;

    xmlNode *           child       = node->children;
    xmlNode *           grandchild  = 0;

    while(child != 0 && child->type != XML_ELEMENT_NODE)
    {
        child = child->next;
    }

    if(child != 0)
    {
        attr = new VectorAttribute(
                        reinterpret_cast<const char *>(node->name));

        for(child = child; child != 0; child = child->next)
        {
            grandchild = child->children;

            if( grandchild != 0 && (grandchild->type == XML_TEXT_NODE ||
                                    grandchild->type == XML_CDATA_SECTION_NODE))
            {
                attr->replace(
                        reinterpret_cast<const char *>(child->name),
                        reinterpret_cast<const char *>(grandchild->content) );
            }
        }
    }

    return attr;
}

/* ------------------------------------------------------------------------ */
/* ------------------------------------------------------------------------ */

int Template::from_xml(const string &xml_str)
{
    xmlDocPtr xml_doc = 0;
    xmlNode * root_element;

    // Parse xml string as libxml document
    xml_doc = xmlParseMemory (xml_str.c_str(),xml_str.length());

    if (xml_doc == 0) // Error parsing XML Document
    {
        return -1;
    }

    // Get the <TEMPLATE> element
    root_element = xmlDocGetRootElement(xml_doc);
    if( root_element == 0 )
    {
        return -1;
    }

    rebuild_attributes(root_element);

    xmlFreeDoc(xml_doc);

    return 0;
}

/* ------------------------------------------------------------------------ */
/* ------------------------------------------------------------------------ */

int Template::from_xml_node(const xmlNodePtr node)
{
    if (node == 0)
    {
        return -1;
    }

    rebuild_attributes(node);

    return 0;
}

/* ------------------------------------------------------------------------ */
/* ------------------------------------------------------------------------ */

void Template::merge(const Template * from_tmpl)
{
    multimap<string,Attribute *>::const_iterator it;

    for (it = from_tmpl->attributes.begin(); it != from_tmpl->attributes.end(); ++it)
    {
        this->erase(it->first);
    }

    for (it = from_tmpl->attributes.begin(); it != from_tmpl->attributes.end(); ++it)
    {
        this->set(it->second->clone());
    }
}

/* ------------------------------------------------------------------------ */
/* ------------------------------------------------------------------------ */

void Template::merge(const Template * from_tmpl, const map<string, vector<string>> restricted_attributes)
{
    multimap<string,Attribute *>::const_iterator it;
    multimap<string,Attribute *>::const_iterator it_attr;
    map<string,vector<string>>::const_iterator it_map;
    vector<string>::const_iterator it_v;
    VectorAttribute *vattr, *from_vattr;

    for (it = from_tmpl->attributes.begin(); it != from_tmpl->attributes.end(); ++it)
    {
        if ( it->second->type() == 0 ) { //simpleAttribute
            if( !check(it->first, restricted_attributes)) { //check restricted attribute
                this->erase(it->first);
                this->set(it->second->clone());
            }
        } else if ( it->second->type() == 1 ) { //vector
            it_map = restricted_attributes.find(it->first);
            it_attr = this->attributes.find(it->first);
            vattr = dynamic_cast<VectorAttribute*>(it_attr->second);
            from_vattr = dynamic_cast<VectorAttribute*>(it->second);
            if (it_map != restricted_attributes.end()){ //have restricted attribute for this key
                vattr->merge(from_vattr, it_map->second);
            } else {
                vattr->merge(from_vattr, true);
            }
        }
    }
}

/* ------------------------------------------------------------------------ */
/* ------------------------------------------------------------------------ */

void merge(const Template * from_tmpl,const map<string, vector<string>> restricted_attributes,
       const map<string,string> check_multiple_attributes)
    {
    std::pair <std::multimap<string,Attribute *>::iterator, std::multimap<string,Attribute *>::iterator> ret; //Iterator for multiple attributes
    multimap<string,Attribute *>::const_iterator it; //iterator for the FROM_TMPL
    multimap<string,Attribute *>::const_iterator it_attr; //iterator for the THIS->ATTRIBUTES
    map<string,vector<string>>::const_iterator it_map; // iterator for the RESTRICTED_ATTRIBUTES
    map<string,string>::const_iterator it_multiple; // iterator for the CHECK_MULTIPLE_ATTRIBUTES

    VectorAttribute *vattr, *from_vattr;
    string from_value, tmpl_value;

    for (it = from_tmpl->attributes.begin(); it != from_tmpl->attributes.end(); ++it)
    {
        if ( it->second->type() == 0 ) { //simpleAttribute
            if( !check(it->first, restricted_attributes)) { //check restricted attribute
                this->erase(it->first);
                this->set(it->second->clone());
            }
        } else if ( it->second->type() == 1 ) { //vector
            it_map = restricted_attributes.find(it->first);

            it_multiple = check_multiple_attributes.find(it->first);
            if (it_multiple != check_multiple_attributes.end()){ //check if this attribute is a multiple attribute
                int rc, from_rc;
                from_vattr = dynamic_cast<VectorAttribute*>(it->second);

                ret = this->attributes.equal_range(it->first);
                for (std::multimap<string,Atribute *>::iterator it_ret=ret.first; it_ret!=ret.second; ++it_ret){

                    vattr = dynamic_cast<VectorAttribute*>(it_ret->second);

                    from_rc = from_vattr.vector_value(it_multiple->second, from_value);

                    rc = vattr.vector_value(it_multiple->second, tmpl_value);

                    if ( from_rc == 0 && rc == 0 && from_value == tmpl_value){ //found element by ID
                        break;
                    }
                }
            } else {
                it_attr = this->attributes.find(it->first);
                vattr = dynamic_cast<VectorAttribute*>(it_attr->second);
                from_vattr = dynamic_cast<VectorAttribute*>(it->second);
            }

            if (it_map != restricted_attributes.end()){ //have restricted attribute for this key
                vattr->merge(from_vattr, it_map->second);
            } else {
                vattr->merge(from_vattr, true);
            }
        }
    }
}

void Template::rebuild_attributes(const xmlNode * root_element)
{
    xmlNode * cur_node = 0;

    Attribute * attr;

    clear();

    // Get the root's children and try to build attributes.
    for (cur_node = root_element->children;
         cur_node != 0;
         cur_node = cur_node->next)
    {
        if (cur_node->type == XML_ELEMENT_NODE)
        {
            // Try to build a single attr.
            attr = single_xml_att(cur_node);
            if(attr == 0)   // The xml element wasn't a single attr.
            {
                // Try with a vector attr.
                attr = vector_xml_att(cur_node);
            }

            if(attr != 0)
            {
                set(attr);
            }
        }
    }
}

/* -------------------------------------------------------------------------- */
/* -------------------------------------------------------------------------- */

void Template::set_restricted_attributes(vector<const SingleAttribute *>& rattrs, map<string, vector<string>>& restricted_attributes)
{
    size_t pos;
    string avector, vattr;
    vector<const Attribute *> values;
    map<string,vector<string>>::iterator it_map;

    for (unsigned int i=0; i < rattrs.size(); i++)
    {
        pos = rattrs[i]->value().find("/");

        if (pos != string::npos) //Vector Attribute
        {
            avector = rattrs[i]->value().substr(0,pos);
            vattr   = rattrs[i]->value().substr(pos+1);
            it_map = restricted_attributes.find(avector);
            if ( it_map != restricted_attributes.end() ) { //exits
                it_map->second.push_back(vattr);
            }
            else {
                restricted_attributes.insert(pair<string,vector<string> >(avector, vector<string>()));
                restricted_attributes[avector].push_back(vattr);
            }
        }
        else //Single Attribute
        {
             restricted_attributes.insert(pair<string,vector<string> >(rattrs[i]->value(), vector<string>()));
        }
    }
}

/* -------------------------------------------------------------------------- */
/* -------------------------------------------------------------------------- */

/*static int get_attributes(
        multimap<string, Attribute *>& attributes,
        const string& name, vector<const Attribute*>& values)
{
    multimap<string, Attribute *>::const_iterator       i;
    pair<multimap<string, Attribute *>::const_iterator,
    multimap<string, Attribute *>::const_iterator>      index;
    int                                           j;

    index = attributes.equal_range(name);

    for ( i = index.first,j=0 ; i != index.second ; i++,j++ )
    {
        values.push_back(i->second);
    }

    return j;
}*/

bool Template::check(string rs_attr, const map<string, vector<string>>& restricted_attributes)
{
    for(map<string, vector<string>>::const_iterator it_map = restricted_attributes.begin(); it_map != restricted_attributes.end(); it_map++) {
        if (it_map->first == rs_attr){
            return true;
        }
        for(std::vector<string>::const_iterator it_v = it_map->second.begin(); it_v != it_map->second.end(); ++it_v) {
             if (*it_v == rs_attr){
                return true;
            }
        }
    }
    return false;
}

/* -------------------------------------------------------------------------- */
/* -------------------------------------------------------------------------- */

void Template::remove_restricted()
{}

/* -------------------------------------------------------------------------- */
/* -------------------------------------------------------------------------- */

void Template::remove_all_except_restricted()
{}

/* -------------------------------------------------------------------------- */
/* -------------------------------------------------------------------------- */

bool Template::has_restricted()
{
    return false;
}

/* -------------------------------------------------------------------------- */
/* -------------------------------------------------------------------------- */

static int get_attributes(
        multimap<string, Attribute *>& attributes,
        const string& name, vector<Attribute*>& values)
{
    multimap<string, Attribute *>::iterator       i;
    pair<multimap<string, Attribute *>::iterator,
    multimap<string, Attribute *>::iterator>      index;
    int                                           j;

    index = attributes.equal_range(name);

    for ( i = index.first,j=0 ; i != index.second ; i++,j++ )
    {
        values.push_back(i->second);
    }

    return j;
}

void Template::remove_restricted(const map<string, vector<string>> restricted_attributes)
{
    for(map<string, vector<string>>::const_iterator it_map = restricted_attributes.begin(); it_map != restricted_attributes.end(); it_map++) {
        for(std::vector<string>::const_iterator it_v = it_map->second.begin(); it_v != it_map->second.end(); ++it_v) {
            erase(*it_v);
        }
        erase(it_map->first);
    }           
}

/* -------------------------------------------------------------------------- */
/* -------------------------------------------------------------------------- */

void Template::remove_all_except_restricted(const map<string, vector<string>> restricted_attributes)
{
    vector<Attribute *> restricted;

    for(map<string, vector<string>>::const_iterator it_map = restricted_attributes.begin(); it_map != restricted_attributes.end(); it_map++) {
        for(std::vector<string>::const_iterator it_v = it_map->second.begin(); it_v != it_map->second.end(); ++it_v) {
            get_attributes(attributes, *it_v, restricted);
        }
        get_attributes(attributes, it_map->first, restricted);
    }

    vector<Attribute *>::iterator res_it;

    for (res_it = restricted.begin(); res_it != restricted.end(); res_it++)
    {
        remove(*res_it);
    }

    clear();

    for (res_it = restricted.begin(); res_it != restricted.end(); res_it++)
    {
        set(*res_it);
    }
}

/* -------------------------------------------------------------------------- */
/* -------------------------------------------------------------------------- */

void Template::clear()
{
    if (attributes.empty())
    {
        return;
    }

    multimap<string,Attribute *>::iterator it;

    for ( it = attributes.begin(); it != attributes.end(); it++)
    {
        delete it->second;
    }

    attributes.clear();
}

